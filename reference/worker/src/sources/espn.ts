import { z } from 'zod';
import type { Event, Snapshot, Team } from '../../../packages/contracts/src';
import { downDistanceText } from '../../../packages/field/src';
import { initialSnapshot, pivotal } from '../../../packages/sports-core/src';
import { espnVenuePhoto } from '../../../packages/venues/src';
const competitor = z
  .object({
    id: z.string(),
    homeAway: z.enum(['home', 'away']),
    score: z.union([z.string(), z.number()]).optional(),
    team: z.object({
      id: z.string().optional(),
      location: z.string(),
      name: z.string(),
      abbreviation: z.string(),
      color: z.string().optional(),
      logos: z.array(z.object({ href: z.string().url() })).optional(),
    }),
    record: z
      .array(z.object({ type: z.string(), summary: z.string() }))
      .optional(),
  })
  .passthrough();
const status = z
  .object({
    period: z.number().optional(),
    displayClock: z.string().optional(),
    type: z.object({
      name: z.string(),
      state: z.string(),
      completed: z.boolean().optional(),
      description: z.string().optional(),
    }),
  })
  .passthrough();
const competition = z
  .object({
    id: z.string(),
    date: z.string(),
    competitors: z.array(competitor),
    status,
    broadcasts: z
      .array(
        z.object({
          names: z.array(z.string()).optional(),
          media: z.object({ shortName: z.string().optional() }).optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
const summarySchema = z
  .object({
    header: z.object({ id: z.string(), competitions: z.array(competition) }),
    gameInfo: z
      .object({
        weather: z
          .object({
            temperature: z.number().finite().optional(),
            precipitation: z.number().min(0).max(100).optional(),
            link: z.object({ href: z.string().optional() }).optional(),
          })
          .optional()
          .catch(undefined),
        venue: z
          .object({
            id: z.string().optional(),
            images: z
              .array(
                z.object({
                  href: z.string(),
                  rel: z.array(z.string()).optional(),
                }),
              )
              .optional(),
            fullName: z.string(),
            address: z
              .object({
                city: z.string(),
                state: z.string().optional(),
                country: z.string().optional(),
              })
              .optional(),
            indoor: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    boxscore: z
      .object({
        teams: z
          .array(
            z.object({
              team: z.object({ id: z.string() }),
              statistics: z.array(
                z.object({ name: z.string(), displayValue: z.string() }),
              ),
            }),
          )
          .optional(),
      })
      .optional(),
    drives: z
      .object({
        previous: z.array(z.any()).optional(),
        current: z.any().optional(),
      })
      .optional(),
    plays: z.array(z.any()).optional(),
  })
  .passthrough();
export type ScheduleGame = {
  id: string;
  name: string;
  date: string;
  broadcast: string;
  status: string;
};
export async function discoverNFL(date?: string): Promise<ScheduleGame[]> {
  const day =
    date ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date())
      .replaceAll('-', '');
  const r = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}`,
    { signal: AbortSignal.timeout(12000) },
  );
  if (!r.ok) throw new Error(`ESPN schedule HTTP ${r.status}`);
  const raw = z
    .object({
      events: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          date: z.string(),
          competitions: z.array(
            z.object({
              broadcasts: z
                .array(z.object({ names: z.array(z.string()) }))
                .optional(),
            }),
          ),
          status,
        }),
      ),
    })
    .parse(await r.json());
  return raw.events.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    broadcast:
      e.competitions[0]?.broadcasts?.flatMap((b) => b.names).join(' / ') ??
      'Broadcast unavailable',
    status: e.status.type.state,
  }));
}
export async function fetchSummary(id: string) {
  if (!/^\d+$/.test(id)) throw new Error('Invalid ESPN ID');
  const r = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`,
    { signal: AbortSignal.timeout(12000) },
  );
  if (!r.ok) throw new Error(`ESPN summary HTTP ${r.status}`);
  return summarySchema.parse(await r.json());
}
export function liveSnapshot(raw: unknown, broadcast?: string): Snapshot {
  const d = summarySchema.parse(raw),
    c = d.header.competitions[0];
  if (!c) throw new Error('Missing competition');
  const home = c.competitors.find((t) => t.homeAway === 'home'),
    away = c.competitors.find((t) => t.homeAway === 'away');
  if (!home || !away) throw new Error('Missing competitors');
  const team = (t: typeof home): Team => ({
    espnId: t.team.id ?? t.id,
    logo: t.team.logos?.[0]?.href,
    name: t.team.name,
    city: t.team.location,
    abbr: t.team.abbreviation,
    color: `#${t.team.color ?? '8b9da7'}`,
    record:
      t.record?.find((r) => r.type === 'total')?.summary ??
      'Record unavailable',
  });
  const address = d.gameInfo?.venue?.address;
  const venueLocation = address
    ? [
        address.city,
        address.state ||
          (address.country !== 'USA' ? address.country : undefined),
      ]
        .filter(Boolean)
        .join(', ')
    : undefined;
  const weather = d.gameInfo?.weather;
  let forecastUrl: string | undefined;
  try {
    const url = new URL(weather?.link?.href ?? '');
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      url.protocol = 'https:';
      forecastUrl = url.href;
    }
  } catch {
    /* No usable forecast link. */
  }
  const s = initialSnapshot();
  Object.assign(s, {
    id: `nfl-${d.header.id}`,
    mode: 'live',
    home: team(home),
    away: team(away),
    title: `${away.team.location} at ${home.team.location}`,
    venue: d.gameInfo?.venue?.fullName ?? 'Venue unavailable',
    venueId: d.gameInfo?.venue?.id,
    venueLocation,
    weather:
      weather &&
      (weather.temperature !== undefined || weather.precipitation !== undefined)
        ? {
            temperature: weather.temperature,
            precipitation: weather.precipitation,
            forecastUrl,
          }
        : undefined,
    venuePhoto: espnVenuePhoto(d.gameInfo?.venue?.images, d.header.id),
    broadcast:
      broadcast ??
      c.broadcasts
        ?.flatMap(
          (b) => b.names ?? (b.media?.shortName ? [b.media.shortName] : []),
        )
        .join(' / ') ??
      'ESPN',
    scheduledAt: c.date,
    market: null,
  });
  s.statsAvailable = false;
  s.simulation.total = 0;
  s.health.sports = {
    status: 'live',
    message: 'ESPN · adaptive polling',
    lastSuccess: new Date().toISOString(),
  };
  s.health.market = {
    status: 'unavailable',
    message: 'Looking for a confident winner-market match',
    lastSuccess: null,
  };
  return s;
}
function gameStatus(name: string, state: string): Snapshot['status'] {
  if (/CANCEL/.test(name)) return 'canceled';
  if (/POSTPON/.test(name)) return 'postponed';
  if (state === 'post') return 'final';
  return state === 'in' ? 'live' : 'scheduled';
}
export type AdapterEvent = Pick<
  Event,
  'type' | 'payload' | 'sourceEventKey' | 'occurredAt' | 'pivotal'
>;
export function normalizeESPN(raw: unknown, current: Snapshot): AdapterEvent[] {
  const d = summarySchema.parse(raw),
    c = d.header.competitions[0];
  if (!c) throw new Error('Missing competition');
  const home = c.competitors.find((t) => t.homeAway === 'home')!,
    away = c.competitors.find((t) => t.homeAway === 'away')!;
  if (!home || !away) throw new Error('Missing teams');
  const out: AdapterEvent[] = [];
  const emit = (
    type: Event['type'],
    payload: unknown,
    key = type,
    at: string | null = null,
    isPivotal = false,
  ) =>
    out.push({
      type,
      payload,
      sourceEventKey: `espn:${c.id}:${key}`,
      occurredAt: at,
      pivotal: isPivotal,
    } as AdapterEvent);
  const name = c.status.type.name;
  emit('game.status_changed', {
    status: gameStatus(name, c.status.type.state),
    banner: /DELAY|SUSPEND/.test(name)
      ? (c.status.type.description ?? 'Play interrupted')
      : null,
  });
  const score = (value: unknown, previous: number) =>
    value === undefined
      ? previous
      : Number.isFinite(Number(value))
        ? Number(value)
        : previous;
  emit('score.changed', {
    home: score(home.score, current.homeScore),
    away: score(away.score, current.awayScore),
  });
  const drives = [
    ...(d.drives?.previous ?? []),
    ...(d.drives?.current ? [d.drives.current] : []),
  ];
  const plays = d.plays ?? drives.flatMap((d) => d.plays ?? []);
  // Sort source sequence numbers, never quarter/clock alone. Deduplicate overlapping current/previous drives.
  const unique = new Map<string, any>();
  for (const p of plays)
    if (p.id && typeof p.text === 'string') unique.set(String(p.id), p);
  const ordered = [...unique.values()].sort(
    (a, b) =>
      Number(a.sequenceNumber ?? a.id) - Number(b.sequenceNumber ?? b.id),
  );
  let priorHome = 0,
    priorAway = 0;
  for (const p of ordered) {
    const text = p.text as string;
    const turnover =
      typeof p.isTurnover === 'boolean'
        ? p.isTurnover
        : /intercept|fumble.*recover/i.test(text);
    const kind = p.scoringPlay
      ? 'score'
      : turnover
        ? 'turnover'
        : /penalty/i.test(text)
          ? 'penalty'
          : /review|reversed/i.test(text)
            ? 'review'
            : /injur/i.test(text)
              ? 'injury'
              : 'play';
    const specialKick = /punt|kickoff/i.test(p.type?.text ?? '');
    const returnGain = specialKick
      ? [...text.matchAll(/for (-?\d+) yards?/gi)].at(-1)?.[1]
      : undefined;
    const teamId = String(p.start?.team?.id ?? p.team?.id ?? '');
    const old = current.plays.find((x) => x.id === String(p.id));
    const payload = {
      id: String(p.id),
      period: Number(p.period?.number ?? 0),
      clock: String(p.clock?.displayValue ?? '—'),
      team: teamId === home.id ? 'home' : teamId === away.id ? 'away' : 'none',
      text,
      playType: typeof p.type?.text === 'string' ? p.type.text : undefined,
      kind,
      yards: typeof p.statYardage === 'number' ? p.statYardage : undefined,
      gainYards: specialKick
        ? returnGain === undefined
          ? 0
          : Number(returnGain)
        : typeof p.statYardage === 'number'
          ? p.statYardage
          : undefined,
      revision: old?.revision ?? 1,
      down: typeof p.start?.down === 'number' ? p.start.down : undefined,
      yardsToEndzone:
        typeof p.start?.yardsToEndzone === 'number'
          ? p.start.yardsToEndzone
          : undefined,
      homeScore:
        Number.isInteger(p.homeScore) && p.homeScore >= 0
          ? p.homeScore
          : undefined,
      awayScore:
        Number.isInteger(p.awayScore) && p.awayScore >= 0
          ? p.awayScore
          : undefined,
      scoreMargin:
        typeof p.homeScore === 'number' && typeof p.awayScore === 'number'
          ? Math.abs(
              p.scoringPlay ? priorHome - priorAway : p.homeScore - p.awayScore,
            )
          : undefined,
      scrimmage:
        Number(p.start?.down) >= 1 &&
        !/punt|field goal|extra point|kickoff/i.test(p.type?.text ?? ''),
      sack: /sack/i.test(p.type?.text ?? '') || /\bsacked\b/i.test(text),
      turnover,
      noPlay: /no play|play nullified/i.test(text),
      endTeam:
        String(p.end?.team?.id) === home.id
          ? 'home'
          : String(p.end?.team?.id) === away.id
            ? 'away'
            : 'none',
      scoringTeam: p.scoringPlay
        ? Number(p.homeScore) > priorHome
          ? 'home'
          : Number(p.awayScore) > priorAway
            ? 'away'
            : undefined
        : undefined,
      converted:
        typeof p.end?.down === 'number' && p.start?.team?.id && p.end?.team?.id
          ? String(p.start.team.id) === String(p.end.team.id) &&
            (p.end.down === 1 || p.scoringPlay === true)
          : undefined,
    };
    priorHome = score(p.homeScore, priorHome);
    priorAway = score(p.awayScore, priorAway);
    if (
      old &&
      Object.entries(payload).every(
        ([key, value]) => key === 'revision' || (old as any)[key] === value,
      )
    )
      continue;
    if (old) payload.revision = old.revision + 1;
    emit(
      old ? 'play.corrected' : 'play.recorded',
      payload,
      `play:${p.id}:revision:${payload.revision}` as any,
      p.wallclock ?? null,
      pivotal(kind),
    );
  }
  const last = ordered.at(-1);
  const situation = (c.situation ?? {}) as any;
  const possession = String(situation.possession ?? last?.end?.team?.id ?? '');
  const sourceDown = [
    situation.downDistanceText,
    last?.end?.shortDownDistanceText,
  ].find((value) => typeof value === 'string' && value.trim());
  const downText = downDistanceText(sourceDown);
  // Do not combine a newer situation's down/possession with an older play's spot.
  const end = last?.end;
  const samePossession = String(end?.team?.id ?? '') === possession;
  const reportedDown = /^([1-4])/.exec(downText)?.[1];
  const aligned =
    samePossession &&
    (!reportedDown || Number(reportedDown) === end?.down) &&
    (!(typeof situation.distance === 'number') ||
      situation.distance === end?.distance);
  const position =
    typeof situation.yardsToEndzone === 'number'
      ? situation
      : aligned
        ? end
        : undefined;
  const yards = position?.yardsToEndzone;
  const yardLine =
    typeof yards === 'number' &&
    Number.isFinite(yards) &&
    yards >= 0 &&
    yards <= 100
      ? 100 - yards
      : null;
  const distance =
    position === situation ? situation.distance : position?.distance;
  emit('game.clock_updated', {
    period: c.status.period ?? last?.period?.number ?? 0,
    clock: c.status.displayClock ?? last?.clock?.displayValue ?? '—',
    down: downText,
    distance:
      typeof distance === 'number' && Number.isFinite(distance) && distance >= 0
        ? distance
        : null,
    possession:
      possession === home.id
        ? 'home'
        : possession === away.id
          ? 'away'
          : 'none',
    yardLine,
    homeTimeouts: situation.homeTimeouts ?? null,
    awayTimeouts: situation.awayTimeouts ?? null,
  });
  const stats = { ...current.stats };
  let hasStats = false;
  for (const t of d.boxscore?.teams ?? []) {
    const side =
      t.team.id === home.id ? 'home' : t.team.id === away.id ? 'away' : null;
    if (!side) continue;
    const keys: Record<string, string> = {
      totalYards: 'Yards',
      netPassingYards: 'Pass',
      rushingYards: 'Rush',
      firstDowns: 'First',
      turnovers: 'Turnovers',
    };
    for (const st of t.statistics) {
      if (keys[st.name] && Number.isFinite(Number(st.displayValue))) {
        (stats as any)[side + keys[st.name]] = Number(st.displayValue);
        hasStats = true;
      }
    }
  }
  if (hasStats) emit('box_score.updated', stats);
  return out;
}
export function pollInterval(s: Snapshot, failures = 0) {
  if (failures) return Math.min(60000, 2000 * 2 ** Math.min(failures, 5));
  if (
    s.status === 'final' ||
    s.status === 'canceled' ||
    s.status === 'postponed'
  )
    return null;
  if (s.status === 'live') return 2000;
  return Date.parse(s.scheduledAt) - Date.now() < 900000 ? 5000 : 60000;
}
