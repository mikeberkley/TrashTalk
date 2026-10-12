import { gameSummary } from '../../packages/contracts/src/game-summary';
import { DurableObject } from 'cloudflare:workers';
import { demoSnapshot, fixture, showcaseCursor } from '../../fixtures/nfl/demo';
import {
  controlSchema,
  type Event,
  type Snapshot,
} from '../../packages/contracts/src';
import {
  collectionWindow,
  defaultExpertConfig,
  expertConfigSchema,
  selectExperts,
  type ExpertConfig,
} from '../../packages/expert/src';
import { fanKey } from '../../packages/fan/src';
import { applyEvent } from '../../packages/sports-core/src';
import type { Env } from './env';
import { ensureShareImage } from './share-images';
import { registryRequest } from './featured';
import { acceptFanResult } from './jobs/fan';
import { trashTalkRequest, trashStateKey } from './jobs/trash-talk';
import type { TrashTalkState } from '../../packages/trash-talk/src';
import { trashTalkRate } from './trash-talk-rate';
import { RecapService } from './jobs/recap';
import { createPoster, POSTER_VERSION, posterContext } from './jobs/poster';
import {
  acceptPressConferenceResult,
  nextPressConferenceAt,
} from './jobs/press-conferences';
import { acceptStorylineResult } from './jobs/storylines';
import { expertConfig, featured } from './room-client';
import { maybeInjuries } from './room-injuries';
import {
  maybeAI,
  maybeFan,
  maybePressConferences,
  maybeStorylines,
} from './room-jobs';
import { ensureMarket } from './room-market';
import { loadRoom, saveRoom } from './room-persistence';
import {
  fetchSummary,
  liveSnapshot,
  normalizeESPN,
  pollInterval,
} from './sources/espn';
import { ingestSchema } from './sources/ingest';
import { injuryRoleRequest } from './sources/injury-roles';
import { MarketBook } from './sources/polymarket';
import { applyTeamDirectory } from './teams';
export class GameRoom extends DurableObject<Env> {
  state!: Snapshot;
  recaps = new RecapService();
  events: Event[] = [];
  failures = 0;
  fingerprints: Record<string, string> = {};
  savedSequence = 0;
  marketSocket: WebSocket | null = null;
  marketBook = new MarketBook();
  marketAwayBook = new MarketBook();
  marketPing: ReturnType<typeof setInterval> | null = null;
  marketLastAttempt = 0;
  marketLastMessage = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      Object.assign(this, await loadRoom(ctx.storage));
    });
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/trash-talk-visitor')
      return this.ctx.blockConcurrencyWhile(() =>
        trashTalkRate(
          request,
          this.ctx.storage,
          () => {
            const id = url.searchParams.get('gameId')!;
            const target = this.env.GAME_ROOMS.get(
              this.env.GAME_ROOMS.idFromName(id),
            );
            url.pathname = '/trash-talk';
            return target.fetch(new Request(url, request));
          },
          async (jobId) => {
            const record = await this.env.ASSETS?.get(trashStateKey(jobId));
            return record ? record.json<TrashTalkState>() : null;
          },
        ),
      );
    if (
      [
        '/share-claim',
        '/share-release',
        '/trash-talk-claim',
        '/trash-talk-release',
      ].includes(url.pathname)
    )
      return this.ctx.blockConcurrencyWhile(async () => {
        const leaseKey = url.pathname.startsWith('/trash-talk')
          ? `trash-lease:${url.searchParams.get('jobId')}`
          : 'shareClaimUntil';
        const until = await this.ctx.storage.get<number>(leaseKey);
        if (url.pathname.endsWith('-release')) {
          await this.ctx.storage.delete(leaseKey);
          return Response.json({ ok: true });
        }
        if (until && until > Date.now())
          return new Response('Busy', { status: 409 });
        await this.ctx.storage.put(leaseKey, Date.now() + 5 * 60000);
        return Response.json({ ok: true });
      });
    if (url.pathname === '/injury-roles')
      return this.ctx.blockConcurrencyWhile(() =>
        injuryRoleRequest(request, this.ctx.storage),
      );
    if (url.pathname.startsWith('/registry'))
      return this.ctx.blockConcurrencyWhile(() =>
        registryRequest(request, this.ctx.storage, this.env.FEATURED_ESPN_ID),
      );
    if (url.pathname === '/deactivate') {
      await this.ctx.storage.put('inactive', true);
      await this.ctx.storage.deleteAlarm();
      if (this.marketPing) clearInterval(this.marketPing);
      this.marketSocket?.close();
      this.marketSocket = null;
      return Response.json({ ok: true });
    }
    if (url.pathname === '/activate') {
      if (!(await featured(this.env, url.searchParams.get('gameId') ?? '')))
        return Response.json({ inactive: true });
      await this.ctx.storage.delete('inactive');
    }
    if (url.pathname === '/expert-config')
      return this.ctx.blockConcurrencyWhile(async () => {
        const config =
          (await this.ctx.storage.get<ExpertConfig>('expertConfig')) ??
          structuredClone(defaultExpertConfig);
        if (request.method === 'PUT') {
          const next = expertConfigSchema.parse(await request.json());
          if (next.revision !== config.revision)
            return Response.json(
              {
                error:
                  'Settings changed in another session. Reload before saving.',
              },
              { status: 409 },
            );
          next.revision++;
          await this.ctx.storage.put('expertConfig', next);
          this.ctx.storage.sql.exec(
            'CREATE TABLE IF NOT EXISTS expert_audit (at TEXT, identity TEXT, before_json TEXT, after_json TEXT)',
          );
          this.ctx.storage.sql.exec(
            'INSERT INTO expert_audit VALUES(?,?,?,?)',
            new Date().toISOString(),
            request.headers.get('X-Operator') ?? 'unknown',
            JSON.stringify(config),
            JSON.stringify(next),
          );
          return Response.json(next);
        }
        return Response.json(config);
      });
    // Homepage reads must not wait for market setup or postgame maintenance.
    if (
      url.pathname === '/summary' &&
      this.state.id === url.searchParams.get('gameId')
    )
      return Response.json(gameSummary(this.state));
    if (this.state.mode === 'simulation') {
      const teams = demoSnapshot(0);
      this.state.home.logo = teams.home.logo;
      this.state.away.logo = teams.away.logo;
      await applyTeamDirectory(this.state, this.env.DB);
    }
    const requested = url.searchParams.get('gameId');
    if (
      requested &&
      requested !== 'nfl-demo' &&
      this.state.mode === 'simulation'
    ) {
      await this.ctx.blockConcurrencyWhile(async () => {
        const raw = await fetchSummary(requested.replace('nfl-', ''));
        this.state = liveSnapshot(raw);
        this.events = [];
        this.savedSequence = 0;
        this.fingerprints = {};
        await this.pollSports();
      });
    }

    if (url.pathname === '/summary')
      return Response.json(gameSummary(this.state));

    if (url.pathname === '/activate') {
      await this.ctx.blockConcurrencyWhile(async () => {
        try {
          await ensureShareImage(this.ctx.storage, this.env, this.state);
        } catch (error) {
          console.error(
            'Share image enqueue failed',
            this.state.id,
            String(error),
          );
        }
      });
    }
    if (url.pathname === '/trash-talk')
      return this.ctx.blockConcurrencyWhile(() =>
        trashTalkRequest(request, this.state, this.env, this.ctx.storage),
      );
    if (url.pathname === '/recap')
      return this.recaps.respond(request, this.state, this.env);

    if (url.pathname === '/retry-poster')
      return this.ctx.blockConcurrencyWhile(async () => {
        const latest = this.state.posters.at(-1);
        if (!latest || !this.env.AI_JOBS || !this.env.OPENROUTER_API_KEY)
          return Response.json(
            { error: 'Poster generation is unavailable' },
            { status: 400 },
          );
        const now = Date.now(),
          previous =
            (await this.ctx.storage.get<number>('lastPosterRetry')) ?? 0;
        if (now - previous < 60000)
          return Response.json(
            { error: 'Wait one minute between retries' },
            { status: 429 },
          );
        const s = this.state;
        const poster = createPoster(s, latest.id);
        await this.env.AI_JOBS.send({
          kind: 'poster',
          gameId: s.id,
          generation: s.generation,
          jobId: `${poster.id}-retry-${now}`,
          poster,
          context: posterContext(s),
        });
        await this.ctx.storage.put('lastPosterRetry', now);
        this.append({
          type: 'poster.published',
          payload: poster,
          source: 'operator',
        });
        this.state.health.images = {
          status: 'delayed',
          message: 'Regenerating artwork · branded event card available',
          lastSuccess: s.health.images.lastSuccess,
        };
        if (this.env.DB)
          await this.env.DB.prepare(
            'INSERT INTO operator_actions VALUES(?,?,?,?,?,?,?,?)',
          )
            .bind(
              crypto.randomUUID(),
              s.id,
              request.headers.get('X-Operator') ?? 'unknown',
              new Date(now).toISOString(),
              'retry-poster',
              'Operator requested poster regeneration',
              JSON.stringify(latest),
              JSON.stringify(poster),
            )
            .run();
        await this.save();
        this.broadcast();
        return Response.json({ ok: true });
      });
    if (url.pathname === '/collector-plan')
      return this.ctx.blockConcurrencyWhile(async () => {
        const config = expertConfigSchema.parse(await request.json());
        this.state.expertAccounts = {
          home: config.teams[this.state.home.abbr]?.accounts ?? [],
          away: config.teams[this.state.away.abbr]?.accounts ?? [],
        };
        const now = Date.now();
        if (this.state.status === 'final' && !this.state.finalObservedAt)
          this.state.finalObservedAt =
            this.events.find(
              (e) =>
                e.type === 'game.status_changed' &&
                e.payload.status === 'final',
            )?.receivedAt ?? new Date(now).toISOString();
        const window = collectionWindow(this.state, config.schedule, now);
        const lastAttempt =
          (await this.ctx.storage.get<number>('lastXAttempt')) ?? null;
        this.state.socialCollection = {
          phase: window.phase,
          intervalMs: window.intervalMs,
          endsAt: window.endsAt,
          lastHeartbeat: new Date(now).toISOString(),
          lastAttempt: lastAttempt ? new Date(lastAttempt).toISOString() : null,
        };
        if (window.phase === 'stopped')
          this.state.health.social.message =
            'Collection complete · saved posts retained';
        await this.save();
        return Response.json({
          game: {
            id: this.state.id,
            status: this.state.status,
            scheduledAt: this.state.scheduledAt,
            home: this.state.home,
            away: this.state.away,
            finalObservedAt: this.state.finalObservedAt,
          },
          configRevision: config.revision,
          selected: selectExperts(config, this.state),
          window,
          lastAttempt,
        });
      });
    if (url.pathname === '/ingest')
      return this.ctx.blockConcurrencyWhile(async () => {
        const nonce = request.headers.get('X-Ingest-Nonce')!;
        if (await this.ctx.storage.get(`nonce:${nonce}`))
          return Response.json({ error: 'Replay rejected' }, { status: 409 });
        await this.ctx.storage.put(`nonce:${nonce}`, Date.now());
        const nonces = await this.ctx.storage.list<number>({
          prefix: 'nonce:',
        });
        for (const [key, at] of nonces)
          if (Date.now() - at > 600000) await this.ctx.storage.delete(key);
        const data = ingestSchema.parse(await request.json());
        await this.ctx.storage.put('lastXAttempt', Date.now());
        const config = await expertConfig(this.env);
        this.state.expertAccounts = {
          home: config.teams[this.state.home.abbr]?.accounts ?? [],
          away: config.teams[this.state.away.abbr]?.accounts ?? [],
        };
        const permitted = new Set(
          selectExperts(config, this.state).accounts.map((h) =>
            h.toLowerCase(),
          ),
        );
        let added = 0;
        for (const post of data.posts) {
          if (!permitted.has(post.handle.toLowerCase())) continue;
          if (this.state.posts.some((p) => p.id === post.id)) continue;
          this.append({
            type: 'social.post_added',
            payload: post,
            source: 'x',
            sourceEventKey: `x:${post.id}`,
            occurredAt: post.publishedAt,
          });
          added++;
        }
        this.state.health.social = {
          status: data.status,
          message:
            data.status === 'live'
              ? 'Trusted accounts · local bird collector'
              : 'X collector could not retrieve posts',
          lastSuccess:
            data.status === 'live'
              ? new Date().toISOString()
              : this.state.health.social.lastSuccess,
        };
        await this.save();
        this.broadcast();
        return Response.json({ accepted: added });
      });
    if (url.pathname === '/job-result' || url.pathname === '/job-failed')
      return this.ctx.blockConcurrencyWhile(async () => {
        const data = (await request.json()) as any;
        if (
          (await this.ctx.storage.get('inactive')) ||
          data.generation !== this.state.generation
        )
          return Response.json({ ignored: true });
        const resultEventId = `ai-${data.generation}-${data.jobId}`;
        if (this.events.some((event) => event.eventId === resultEventId)) {
          // Also retry persistence if the previous response failed during save.
          await this.save();
          this.broadcast();
          return Response.json({ ignored: true });
        }
        if (data.result?.type === 'press-conferences.published') {
          if (!acceptPressConferenceResult(this.state, data.jobId))
            return Response.json({ ignored: true });
          this.state.pressConferenceRun!.pending = false;
          this.state.pressConferenceRun!.error = false;
        }
        if (
          url.pathname === '/job-failed' &&
          data.kind === 'press-conferences' &&
          this.state.pressConferenceRun?.jobId === data.jobId
        ) {
          this.state.pressConferenceRun!.pending = false;
          this.state.pressConferenceRun!.error = true;
        }
        if (
          data.result?.type === 'poster.published' &&
          data.result.payload.id === 'poster-pre' &&
          data.result.payload.promptVersion !== POSTER_VERSION
        )
          return Response.json({ ignored: true });
        if (data.result?.type === 'fan.published') {
          if (
            !acceptFanResult(this.state, data.jobId, data.result.payload.key)
          ) {
            if (this.state.fanRun?.jobId === data.jobId)
              this.state.fanRun!.pending = false;
            try {
              await this.maybeFan();
            } catch {}
            await this.save();
            this.broadcast();
            return Response.json({ ignored: true });
          }
          this.state.fanRun!.pending = false;
          this.state.fanRun!.error = false;
        }
        if (
          url.pathname === '/job-failed' &&
          data.kind === 'fan' &&
          this.state.fanRun?.jobId === data.jobId
        ) {
          this.state.fanRun!.pending = false;
          this.state.fanRun!.error = true;
        }
        if (data.result?.type === 'storylines.published') {
          if (
            !acceptStorylineResult(
              this.state,
              data.jobId,
              data.scheduledAt,
              Date.now(),
            )
          )
            return Response.json({ ignored: true });
          this.state.storylineRun!.pending = false;
          this.state.storylineRun!.error = false;
        }
        if (
          url.pathname === '/job-failed' &&
          data.kind === 'storylines' &&
          this.state.storylineRun?.jobId === data.jobId &&
          this.state.storylineRun?.pending
        ) {
          this.state.storylineRun!.pending = false;
          this.state.storylineRun!.error = true;
        }
        if (url.pathname === '/job-result') {
          this.append({
            ...data.result,
            source: 'openrouter',
            eventId: resultEventId,
          });
          if (data.result.type === 'poster.published')
            this.state.health.images = {
              status: 'live',
              message: 'OpenRouter · Nano Banana Pro poster',
              lastSuccess: new Date().toISOString(),
            };
        } else if (data.kind === 'poster') {
          this.state.health.images = {
            ...this.state.health.images,
            status: 'unavailable',
            message: 'Generation failed · designed event card retained',
          };
        }
        if (data.result?.type === 'storylines.published')
          try {
            await this.maybeAI();
          } catch {}
        if (
          data.result?.type === 'storylines.published' ||
          data.kind === 'fan' ||
          data.result?.type === 'fan.published'
        )
          try {
            await this.maybeFan();
          } catch {}
        await this.save();
        this.broadcast();
        return Response.json({ ok: true });
      });
    if (url.pathname === '/live') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return new Response('WebSocket required', { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(
        JSON.stringify({
          type: 'snapshot',
          snapshot: this.state,
          serverTime: Date.now(),
        }),
      );
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/events')
      return Response.json({
        generation: this.state.generation,
        events: this.events.filter(
          (e) => e.sequence > Number(url.searchParams.get('after') ?? 0),
        ),
        sequence: this.state.sequence,
      });
    if (url.pathname === '/control')
      return this.ctx.blockConcurrencyWhile(async () => {
        const cmd = controlSchema.parse(await request.json());
        const before = {
          sequence: this.state.sequence,
          simulation: this.state.simulation,
          generation: this.state.generation,
        };
        if (cmd.action === 'reset' || cmd.action === 'showcase') {
          const generation = this.state.generation + 1;
          this.state = demoSnapshot(
            cmd.action === 'reset' ? 0 : showcaseCursor,
          );
          this.state.generation = generation;
          this.savedSequence = 0;
          this.events = fixture.slice(0, this.state.simulation.cursor);
          await this.ctx.storage.deleteAlarm();
        }
        if (cmd.action === 'play') {
          this.state.simulation.playing = true;
          await this.ctx.storage.setAlarm(Date.now() + 100);
        }
        if (cmd.action === 'pause') {
          this.state.simulation.playing = false;
          await this.ctx.storage.deleteAlarm();
        }
        if (cmd.action === 'speed') {
          this.state.simulation.speed = cmd.speed;
        }
        if (cmd.action === 'step') this.advance();
        if (cmd.action === 'finish') {
          let limit = fixture.length;
          while (this.state.simulation.cursor < fixture.length && limit-- > 0)
            this.advance();
          this.state.simulation.playing = false;
          await this.ctx.storage.deleteAlarm();
        }
        if (cmd.action === 'source') {
          const set = new Set(this.state.simulation.pausedSources);
          cmd.paused ? set.add(cmd.source) : set.delete(cmd.source);
          this.state.simulation.pausedSources = [...set];
          this.append({
            type: 'source.status_changed',
            payload: {
              module: cmd.source,
              status: cmd.paused ? 'stale' : 'replay',
              message: cmd.paused
                ? 'Source paused by operator'
                : 'Simulation source resumed',
            },
          } as any);
        }
        if (cmd.action === 'correct' || cmd.action === 'hide') {
          const old = this.state.plays.find((p) => p.id === cmd.playId);
          if (!old)
            return Response.json({ error: 'Play not found' }, { status: 404 });
          this.append({
            type: 'play.corrected',
            payload: {
              ...old,
              text: cmd.text ?? old.text,
              hidden: cmd.action === 'hide' ? true : old.hidden,
              revision: old.revision + 1,
            },
            correctsEventId: old.eventId,
          } as any);
        }
        await applyTeamDirectory(this.state, this.env.DB);
        await this.save();
        const audit = {
          id: crypto.randomUUID(),
          identity: request.headers.get('X-Operator') ?? 'unknown',
          at: new Date().toISOString(),
          action: cmd.action,
          reason: 'reason' in cmd ? cmd.reason : 'Simulation control',
          before,
          after: {
            sequence: this.state.sequence,
            simulation: this.state.simulation,
            generation: this.state.generation,
          },
        };
        const audits = (await this.ctx.storage.get<unknown[]>('audit')) ?? [];
        await this.ctx.storage.put('audit', [...audits, audit]);
        if (this.env.DB)
          await this.env.DB.prepare(
            'INSERT INTO operator_actions VALUES(?,?,?,?,?,?,?,?)',
          )
            .bind(
              audit.id,
              this.state.id,
              audit.identity,
              audit.at,
              audit.action,
              audit.reason,
              JSON.stringify(audit.before),
              JSON.stringify(audit.after),
            )
            .run();
        this.broadcast();
        return Response.json(this.state);
      });
    if (
      (url.pathname === '/snapshot' || url.pathname === '/activate') &&
      !(await this.ctx.storage.get('inactive')) &&
      this.state.mode === 'live'
    )
      await this.ctx.blockConcurrencyWhile(async () => {
        if (
          this.state.status === 'scheduled' &&
          this.state.marketAwayHistory === undefined
        ) {
          await this.ensureMarket();
          await this.save();
          this.broadcast();
        }
        if (this.state.status === 'final') {
          await applyTeamDirectory(this.state, this.env.DB);
          try {
            await this.maybePressConferences();
          } catch {
            if (this.state.pressConferenceRun) {
              this.state.pressConferenceRun.pending = false;
              this.state.pressConferenceRun.error = true;
              await this.save();
            }
          }
        }
        if (
          this.state.status === 'scheduled' ||
          (this.env.AI_JOBS &&
            this.env.OPENROUTER_API_KEY &&
            nextPressConferenceAt(this.state, Date.now()) !== null)
        )
          if (!(await this.ctx.storage.getAlarm()))
            await this.ctx.storage.setAlarm(Date.now() + 1000);
      });
    return Response.json(this.state);
  }
  append(input: Partial<Event>) {
    const n = this.state.sequence + 1;
    const now = new Date().toISOString();
    const event = {
      eventId: `operator-${this.state.generation}-${n}`,
      gameId: this.state.id,
      source: 'operator',
      sourceEventKey: `operator-${n}`,
      occurredAt: now,
      receivedAt: now,
      revision: 1,
      pivotal: false,
      ...input,
      sequence: n,
    } as Event;
    this.state = applyEvent(this.state, event);
    if (
      event.type === 'game.status_changed' &&
      event.payload.status === 'final' &&
      !this.state.finalObservedAt
    )
      this.state.finalObservedAt = now;
    this.events.push(event);
  }
  advance() {
    const start = this.state.simulation.cursor;
    if (start >= fixture.length) {
      this.state.simulation.playing = false;
      return;
    }
    // A frame includes one clock update plus its plays, score, stats, and market ticks.
    let end = start + 1;
    while (end < fixture.length && fixture[end].type !== 'game.clock_updated')
      end++;
    for (const original of fixture.slice(start, end)) {
      const market = original.type.startsWith('market.');
      const sports = !market && !original.type.startsWith('poster.');
      if (
        (market && this.state.simulation.pausedSources.includes('market')) ||
        (sports && this.state.simulation.pausedSources.includes('sports'))
      )
        continue;
      const e = {
        ...original,
        sequence: this.state.sequence + 1,
        receivedAt: new Date().toISOString(),
      };
      this.state = applyEvent(this.state, e);
      this.events.push(e);
      const module = market ? 'market' : 'sports';
      if (this.state.health[module].status === 'replay')
        this.state.health[module].lastSuccess = e.receivedAt;
    }
    this.state.simulation.cursor = end;
    if (end >= fixture.length) this.state.simulation.playing = false;
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.state.mode === 'live') {
        await this.pollSports();
        return;
      }
      if (!this.state.simulation.playing) return;
      this.advance();
      await this.save();
      this.broadcast();
      if (this.state.simulation.playing)
        await this.ctx.storage.setAlarm(
          Date.now() + 6000 / this.state.simulation.speed,
        );
    });
  }
  async pollSports() {
    if (await this.ctx.storage.get('inactive')) return;
    const wasFinal = this.state.status === 'final',
      wasLive = this.state.status === 'live';
    let injurySummary: unknown;
    try {
      const raw = await fetchSummary(this.state.id.replace('nfl-', ''));
      injurySummary = raw;
      const metadata = liveSnapshot(raw);
      this.state.home = metadata.home;
      this.state.away = metadata.away;
      this.state.scheduledAt = metadata.scheduledAt;
      this.state.venue = metadata.venue;
      this.state.venueId = metadata.venueId;
      this.state.venueLocation = metadata.venueLocation;
      this.state.venuePhoto = metadata.venuePhoto;
      this.state.weather = metadata.weather;
      this.state.broadcast = metadata.broadcast;
      await applyTeamDirectory(this.state, this.env.DB);
      for (const e of normalizeESPN(raw, this.state)) {
        const fingerprint = JSON.stringify(e.payload);
        if (this.fingerprints[e.sourceEventKey] === fingerprint) continue;
        this.fingerprints[e.sourceEventKey] = fingerprint;
        this.append({
          ...e,
          source: 'espn',
          eventId: `${e.sourceEventKey}:${this.state.sequence + 1}`,
        } as Partial<Event>);
      }
      this.failures = 0;
      this.state.health.sports = {
        status: this.state.banner ? 'delayed' : 'live',
        message: this.state.banner ?? 'ESPN · adaptive polling',
        lastSuccess: new Date().toISOString(),
      };
    } catch (e) {
      this.failures++;
      this.state.health.sports = {
        ...this.state.health.sports,
        status: this.state.health.sports.lastSuccess ? 'stale' : 'unavailable',
        message: e instanceof Error ? e.message : 'ESPN fetch failed',
      };
    }
    if (!wasFinal)
      await this.maybeInjuries(
        this.state.status === 'final' && !wasLive ? {} : injurySummary,
      );
    const social = this.state.socialCollection;
    if (
      social &&
      social.phase !== 'stopped' &&
      Date.now() - Date.parse(social.lastHeartbeat) > 90000
    )
      this.state.health.social = {
        ...this.state.health.social,
        status: 'stale',
        message: 'Collector heartbeat overdue',
      };
    if (
      this.state.storylineRun &&
      (['live', 'final'].includes(this.state.status) ||
        Date.now() >= Date.parse(this.state.scheduledAt))
    )
      this.state.storylineRun.frozen = true;
    try {
      await this.maybePressConferences();
    } catch {
      if (this.state.pressConferenceRun) {
        this.state.pressConferenceRun!.pending = false;
        this.state.pressConferenceRun!.error = true;
      }
    }
    try {
      await this.maybeStorylines();
    } catch {
      if (this.state.storylineRun) {
        this.state.storylineRun!.pending = false;
        this.state.storylineRun!.error = true;
      }
    }
    try {
      await this.maybeFan();
    } catch (error) {
      console.error(
        'Fan job enqueue failed',
        this.state.id,
        error instanceof Error ? error.message : 'Unknown error',
      );
      if (this.state.fanRun) {
        this.state.fanRun!.pending = false;
        this.state.fanRun!.error = true;
      }
    }
    try {
      await this.maybeAI();
    } catch {
      this.state.health.images = {
        ...this.state.health.images,
        status: 'unavailable',
        message: 'AI queue unavailable · game data continues',
      };
    }
    await this.ensureMarket();
    await this.save();
    this.broadcast();
    const ms =
      this.env.AI_JOBS &&
      this.env.OPENROUTER_API_KEY &&
      nextPressConferenceAt(this.state, Date.now()) !== null
        ? 60000
        : this.state.status === 'final' &&
            this.state.fanAnalysis?.key !== fanKey(this.state) &&
            this.env.AI_JOBS &&
            this.env.OPENROUTER_API_KEY
          ? 60000
          : this.state.status === 'final' && !wasFinal
            ? 15000
            : pollInterval(this.state, this.failures);
    if (ms !== null) await this.ctx.storage.setAlarm(Date.now() + ms);
  }
  async maybeInjuries(raw: unknown) {
    return maybeInjuries(this, this.ctx, this.env, raw);
  }

  async maybePressConferences() {
    return maybePressConferences(this, this.ctx, this.env);
  }

  async maybeFan() {
    return maybeFan(this, this.ctx, this.env);
  }

  async maybeStorylines() {
    return maybeStorylines(this, this.ctx, this.env);
  }

  async maybeAI() {
    return maybeAI(this, this.ctx, this.env);
  }

  async ensureMarket() {
    return ensureMarket(this, this.ctx, this.env);
  }

  async save() {
    this.savedSequence = await saveRoom(
      this.ctx.storage,
      this.env.DB,
      this.state,
      this.events,
      this.fingerprints,
      this.savedSequence,
    );
  }
  broadcast() {
    const message = JSON.stringify({
      type: 'snapshot',
      snapshot: this.state,
      serverTime: Date.now(),
    });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        ws.close(1011, 'Send failed');
      }
    }
  }
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') ws.send('pong');
  }
  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
  }
}
