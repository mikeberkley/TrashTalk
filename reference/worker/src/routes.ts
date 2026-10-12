import { siteShareTags } from './site-share';
import { trashTalkSharePreview } from './trash-talk-share';
import { gameSummary } from '../../packages/contracts/src/game-summary';
import {
  divisionStandings,
  teamSchedule,
  teamStats,
} from './sources/team-season';
import {
  shareKey,
  introKey,
  shareMetaKey,
  shareTags,
  escapeHTML,
  type ShareMetadata,
} from './share-images';
import { Hono } from 'hono';
import { gameIntro } from './game-intro';
import { controlSchema, type Snapshot } from '../../packages/contracts/src';
import {
  collectionWindow,
  expertConfigSchema,
  selectExperts,
} from '../../packages/expert/src';
import { identity } from './auth';
import type { Env } from './env';
import { rankingsStatus } from './power-rankings';
import {
  allowed,
  configRoom,
  expertConfig,
  featured,
  registry,
  registryRoom,
  room,
  roomRequest,
} from './room-client';
import { discoverNFL } from './sources/espn';
import { ingestSchema, verifySignature } from './sources/ingest';
import { teamDirectory } from './teams';
const app = new Hono<{ Bindings: Env; Variables: { operator: string } }>();
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === 'fanlift.ai') {
    url.hostname = 'www.fanlift.ai';
    url.protocol = 'https:';
    return c.redirect(url.toString(), 308);
  }
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.req.path.startsWith('/api')) c.header('Cache-Control', 'no-store');
});
app.use('/api/operator/*', async (c, next) => {
  const user = await identity(c.req.raw, c.env);
  if (!user)
    return c.json(
      { error: 'Operator access is not configured or you are not authorized.' },
      403,
    );
  if (c.req.method !== 'GET') {
    const origin = c.req.header('Origin');
    if (
      origin &&
      origin !== new URL(c.req.url).origin &&
      !(
        c.env.LOCAL_DEV === 'true' &&
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
      )
    )
      return c.json({ error: 'Invalid origin' }, 403);
  }
  c.set('operator', user);
  await next();
});
app.get('/api/assets/*', async (c) => {
  const key = c.req.path.replace('/api/assets/', '');
  if (key.startsWith('_job-results/')) return c.notFound();
  const object = await c.env.ASSETS?.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/png',
      'Cache-Control': 'public,max-age=31536000,immutable',
    },
  });
});
app.get('/api/teams', async (c) =>
  c.json({ teams: await teamDirectory(c.env.DB) }),
);
for (const kind of ['standings', 'schedule', 'statistics'] as const) {
  app.get(`/api/teams/:id/${kind}`, async (c) => {
    const id = c.req.param('id');
    const season = Number(c.req.query('season'));
    if (
      !Number.isInteger(season) ||
      season < 2002 ||
      season > 2100 ||
      !(await teamDirectory()).some((t) => t.id === id)
    )
      return c.json({ error: 'Invalid team or season' }, 400);
    try {
      return c.json(
        await (kind === 'standings'
          ? divisionStandings(id, season)
          : kind === 'schedule'
            ? teamSchedule(id, season)
            : teamStats(id, season)),
      );
    } catch {
      return c.json({ error: 'Team data unavailable. Please try again.' }, 502);
    }
  });
}
app.get('/api/power-rankings', async (c) =>
  c.json(await rankingsStatus(c.env.DB)),
);
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    version: '0.1.0',
    provider: 'openrouter',
    modelConfigured: !!c.env.OPENROUTER_API_KEY,
  }),
);
app.get('/api/schedule', async (c) => c.json({ games: await discoverNFL() }));
app.post('/api/ingest/x', async (c) => {
  if (Number(c.req.header('Content-Length')) > 128000)
    return c.json({ error: 'Body too large' }, 413);
  const body = await c.req.text();
  if (new TextEncoder().encode(body).length > 128000)
    return c.json({ error: 'Body too large' }, 413);
  const timestamp = c.req.header('X-Ingest-Timestamp') ?? null,
    nonce = c.req.header('X-Ingest-Nonce') ?? null;
  if (
    !(await verifySignature(
      c.env.COLLECTOR_SECRET,
      body,
      c.req.path,
      timestamp,
      nonce,
      c.req.header('X-Ingest-Signature') ?? null,
    ))
  )
    return c.json({ error: 'Invalid collector signature' }, 401);
  let data;
  try {
    data = ingestSchema.parse(JSON.parse(body));
  } catch {
    return c.json({ error: 'Invalid batch' }, 400);
  }
  if (!(await featured(c.env, data.gameId)))
    return c.json({ error: 'Game is not featured' }, 403);
  return room(c.env, data.gameId).fetch(
    new Request(`https://room/ingest?gameId=${data.gameId}`, {
      method: 'POST',
      headers: { 'X-Ingest-Nonce': nonce! },
      body: JSON.stringify(data),
    }),
  );
});
app.get('/api/operator/experts', async (c) => {
  const config = await expertConfig(c.env);
  const gameId =
    c.req.query('gameId') ?? (await registry(c.env)).selected[0] ?? 'nfl-demo';
  if (!gameId || !(await allowed(c.env, gameId)))
    return c.json({ error: 'Choose a featured game' }, 400);
  const game = (await (
    await room(c.env, gameId).fetch(roomRequest(gameId, 'snapshot'))
  ).json()) as Snapshot;
  return c.json({
    config,
    game,
    selected: selectExperts(config, game),
    window: collectionWindow(game, config.schedule, Date.now()),
  });
});
app.put('/api/operator/experts', async (c) => {
  let data;
  try {
    const body = await c.req.text();
    if (body.length > 32000)
      return c.json({ error: 'Configuration too large' }, 413);
    data = expertConfigSchema.parse(JSON.parse(body));
  } catch {
    return c.json(
      {
        error:
          'Check handles (1–15 letters, digits, underscores), keywords, and schedule ranges.',
      },
      400,
    );
  }
  return configRoom(c.env).fetch(
    new Request('https://room/expert-config', {
      method: 'PUT',
      headers: { 'X-Operator': c.get('operator') },
      body: JSON.stringify(data),
    }),
  );
});
app.post('/api/collector/plan', async (c) => {
  const body = await c.req.text();
  if (body.length > 1000) return c.json({ error: 'Body too large' }, 413);
  if (
    !(await verifySignature(
      c.env.COLLECTOR_SECRET,
      body,
      c.req.path,
      c.req.header('X-Ingest-Timestamp') ?? null,
      c.req.header('X-Ingest-Nonce') ?? null,
      c.req.header('X-Ingest-Signature') ?? null,
    ))
  )
    return c.json({ error: 'Invalid collector signature' }, 401);
  const config = await expertConfig(c.env),
    ids = (await registry(c.env)).selected;
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    return c.json({ error: 'Invalid request' }, 400);
  }
  const plans = await Promise.allSettled(
    ids.map(async (gameId) =>
      (
        await room(c.env, gameId).fetch(
          new Request(`https://room/collector-plan?gameId=${gameId}`, {
            method: 'POST',
            body: JSON.stringify(config),
          }),
        )
      ).json(),
    ),
  );
  const ready = plans.flatMap((p) =>
    p.status === 'fulfilled' ? [p.value] : [],
  );
  return c.json(input.all ? { plans: ready } : (ready[0] ?? { plans: [] }));
});
app.get('/api/operator/featured', async (c) =>
  c.json(await registry(c.env, true)),
);
app.put('/api/operator/featured/:id', async (c) => {
  await registry(c.env, true);
  const id = c.req.param('id');
  const r = await registryRoom(c.env).fetch(
    new Request('https://room/registry', {
      method: 'PUT',
      headers: { 'X-Operator': c.get('operator') },
      body: JSON.stringify({ id }),
    }),
  );
  if (r.ok)
    c.executionCtx.waitUntil(
      room(c.env, id).fetch(roomRequest(id, 'activate')),
    );
  return r;
});
app.delete('/api/operator/featured/:id', async (c) => {
  const id = c.req.param('id');
  const r = await registryRoom(c.env).fetch(
    new Request('https://room/registry', {
      method: 'DELETE',
      headers: { 'X-Operator': c.get('operator') },
      body: JSON.stringify({ id }),
    }),
  );
  if (r.ok)
    c.executionCtx.waitUntil(
      room(c.env, id).fetch(new Request('https://room/deactivate')),
    );
  return r;
});
app.get('/api/operator/settings', async (c) =>
  c.json({ config: await expertConfig(c.env) }),
);
app.get('/api/operator/status', async (c) => {
  const config = await registry(c.env);
  const games = await Promise.all(
    config.selected.map(async (id) => {
      try {
        const response = await room(c.env, id).fetch(
          roomRequest(id, 'snapshot'),
        );
        if (!response.ok) throw Error();
        const s = (await response.json()) as Snapshot;
        const health = structuredClone(s.health);
        if (
          s.socialCollection &&
          s.socialCollection.phase !== 'stopped' &&
          Date.now() - Date.parse(s.socialCollection.lastHeartbeat) > 90000
        )
          health.social = {
            ...health.social,
            status: 'stale',
            message: 'Collector heartbeat overdue',
          };
        return {
          id,
          name: `${s.away.city} ${s.away.name} at ${s.home.city} ${s.home.name}`,
          status: s.status,
          health,
          collectorHeartbeat: s.socialCollection?.lastHeartbeat,
          collectorAttempt: s.socialCollection?.lastAttempt,
          storylines: s.storylines?.generatedAt,
          outlook: s.fanAnalysis?.generatedAt,
          storylinePending: s.storylineRun?.pending,
          outlookPending: s.fanRun?.pending,
          storylineError: s.storylineRun?.error,
          outlookError: s.fanRun?.error,
        };
      } catch {
        return {
          id,
          name: config.games.find((g) => g.id === id)?.name ?? id,
          status: 'unavailable',
          error: 'Could not reach this game. Other games are unaffected.',
          health: {},
        };
      }
    }),
  );
  return c.json({
    checkedAt: new Date().toISOString(),
    schedule: {
      refreshedAt: config.refreshedAt,
      error: config.error,
      count: config.games.length,
    },
    games,
  });
});
app.get('/api/operator/session', (c) =>
  c.json({ identity: c.get('operator'), local: c.env.LOCAL_DEV === 'true' }),
);
app.get('/api/scoreboard', async (c) => {
  const ids = ['nfl-demo', ...(await registry(c.env)).selected];
  const results = await Promise.allSettled(
    ids.map(async (id) =>
      gameSummary(
        await (
          await room(c.env, id).fetch(roomRequest(id, 'summary'))
        ).json<Snapshot>(),
      ),
    ),
  );
  return c.json({
    games: results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<unknown>).value),
  });
});
app.get('/api/games/:id/share', async (c) => {
  const id = c.req.param('id');
  if (!/^nfl-\d+$/.test(id)) return c.notFound();
  const meta = await (
    await c.env.ASSETS?.get(shareMetaKey(id))
  )?.json<ShareMetadata>();
  if (!meta) return c.json({ ready: false }, 202);
  return c.json({
    ready: true,
    introUrl: meta.introVersion
      ? `/intro-images/${encodeURIComponent(id)}/v${meta.introVersion}.png`
      : undefined,
    url: `${new URL(c.req.url).origin}/games/${id}?share=helmets-v${meta.imageVersion ?? 1}`,
  });
});
app.get('/api/games/:id', async (c) =>
  (await allowed(c.env, c.req.param('id')))
    ? room(c.env, c.req.param('id')).fetch(
        roomRequest(c.req.param('id'), 'snapshot'),
      )
    : c.json({ error: 'Game not found' }, 404),
);
app.post('/api/games/:id/recap', async (c) => {
  const id = c.req.param('id');
  if (!(await allowed(c.env, id)))
    return c.json({ error: 'Game not found' }, 404);
  const origin = c.req.header('Origin');
  if (
    origin &&
    origin !== new URL(c.req.url).origin &&
    !(
      c.env.LOCAL_DEV === 'true' &&
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
    )
  )
    return c.json({ error: 'Invalid origin' }, 403);
  const body = await c.req.text();
  if (body.length > 100) return c.json({ error: 'Body too large' }, 413);
  return room(c.env, id).fetch(
    new Request(`https://room/recap?gameId=${encodeURIComponent(id)}`, {
      method: 'POST',
      body,
    }),
  );
});
app.on(['GET', 'POST'], '/api/games/:id/trash-talk', async (c) => {
  const id = c.req.param('id');
  if (!(await allowed(c.env, id)))
    return c.json({ error: 'Game not found' }, 404);
  const origin = c.req.header('Origin');
  if (
    origin &&
    origin !== new URL(c.req.url).origin &&
    !(
      c.env.LOCAL_DEV === 'true' &&
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
    )
  )
    return c.json({ error: 'Invalid origin' }, 403);
  const body = c.req.method === 'POST' ? await c.req.text() : undefined;
  if (body && body.length > 100)
    return c.json({ error: 'Body too large' }, 413);
  const visitor = c.req.header('CF-Connecting-IP') ?? 'local';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(visitor),
  );
  const visitorKey = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return room(c.env, `trash-talk-visitor:${visitorKey}`).fetch(
    new Request(
      `https://room/trash-talk-visitor?gameId=${encodeURIComponent(id)}&side=${encodeURIComponent(c.req.query('side') ?? '')}`,
      {
        method: c.req.method,
        body,
      },
    ),
  );
});
app.get('/api/games/:id/events', async (c) =>
  (await allowed(c.env, c.req.param('id')))
    ? room(c.env, c.req.param('id')).fetch(
        new Request(
          `https://room/events?gameId=${c.req.param('id')}&after=${c.req.query('after') ?? 0}`,
        ),
      )
    : c.json({ error: 'Game not found' }, 404),
);
app.get('/api/games/:id/archive', async (c) => {
  if (!(await allowed(c.env, c.req.param('id'))))
    return c.json({ error: 'Game not found' }, 404);
  const r = await room(c.env, c.req.param('id')).fetch(
    roomRequest(c.req.param('id'), 'snapshot'),
  );
  const s = (await r.json()) as Snapshot;
  return c.json({
    status: s.status,
    chapters: s.chapters,
    storylines: s.storylines,
    pressConferences: s.pressConferences,
    injuries: s.injuries,
  });
});
app.get('/api/live', async (c) => {
  const id = c.req.query('gameId') ?? '';
  if (!(await allowed(c.env, id)))
    return c.json({ error: 'Unknown game' }, 404);
  return room(c.env, id).fetch(roomRequest(id, 'live', c.req.raw.headers));
});
app.post('/api/operator/games/:id/posters/retry', async (c) => {
  const id = c.req.param('id');
  if (!(await allowed(c.env, id)) || id === 'nfl-demo')
    return c.json({ error: 'Choose a live game' }, 400);
  return room(c.env, id).fetch(
    new Request(`https://room/retry-poster?gameId=${id}`, {
      method: 'POST',
      headers: { 'X-Operator': c.get('operator') },
    }),
  );
});
app.post('/api/operator/simulation/:id/control', async (c) => {
  if (c.req.param('id') !== 'nfl-demo')
    return c.json({ error: 'Unknown simulation' }, 404);
  if (Number(c.req.header('Content-Length')) > 8192)
    return c.json({ error: 'Body too large' }, 413);
  let data;
  try {
    data = controlSchema.parse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid control' }, 400);
  }
  return room(c.env).fetch(
    new Request('https://room/control', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operator': c.get('operator'),
      },
      body: JSON.stringify(data),
    }),
  );
});
app.get('/operator*', async (c) => {
  if (!(await identity(c.req.raw, c.env)))
    return c.text(
      'Operator access is protected. Configure Cloudflare Access before using this route.',
      403,
    );
  return c.env.WEB_ASSETS.fetch(c.req.raw);
});
app.get('/share-images/:id/:file', async (c) => {
  const id = c.req.param('id');
  if (!/^nfl-\d+$/.test(id)) return c.notFound();
  const version = /^v([1-9][0-9]*)\.png$/.exec(c.req.param('file'));
  if (!version) return c.notFound();
  const object = await c.env.ASSETS?.get(shareKey(id, Number(version[1])));
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public,max-age=31536000,immutable',
    },
  });
});
app.get('/intro-images/:id/:file', async (c) => {
  const id = c.req.param('id');
  if (!/^nfl-\d+$/.test(id)) return c.notFound();
  const version = /^v([1-9][0-9]*)\.png$/.exec(c.req.param('file'));
  if (!version) return c.notFound();
  const object = await c.env.ASSETS?.get(introKey(id, Number(version[1])));
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public,max-age=31536000,immutable',
    },
  });
});
app.get('/games/:id', async (c) => {
  const response = await c.env.WEB_ASSETS.fetch(c.req.raw);
  const id = c.req.param('id');
  if (
    !/^nfl-\d+$/.test(id) ||
    !response.headers.get('content-type')?.includes('text/html')
  )
    return response;
  let meta: ShareMetadata | undefined;
  const trashPreview = await trashTalkSharePreview(
    c.env,
    id,
    c.req.query('trashTalk'),
    new URL(c.req.url).origin,
    c.req.query('score'),
    c.req.query('pregame'),
  );
  try {
    meta = await (
      await c.env.ASSETS?.get(shareMetaKey(id))
    )?.json<ShareMetadata>();
  } catch {
    return response;
  }
  if (!meta && !trashPreview) return response;
  const intro = meta ? gameIntro(id, meta) : { head: '', body: '' };
  const previewMeta = trashPreview?.meta ?? meta!;
  const html = (await response.text())
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHTML(previewMeta.title)}</title>`,
    )
    .replace(
      '</head>',
      `${shareTags(new URL(c.req.url).origin, id, previewMeta, trashPreview)}${intro.head}</head>`,
    )
    .replace('<body>', `<body>${intro.body}`);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.delete('Content-Encoding');
  headers.set('Cache-Control', 'no-cache');
  return new Response(html, { status: response.status, headers });
});
app.get('*', async (c) => {
  const response = await c.env.WEB_ASSETS.fetch(c.req.raw);
  if (
    !['/', '/home', '/scoreboard'].includes(c.req.path) ||
    !response.headers.get('content-type')?.includes('text/html')
  )
    return response;
  const html = (await response.text()).replace(
    '</head>',
    `${siteShareTags(new URL(c.req.url).origin)}</head>`,
  );
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.delete('Content-Encoding');
  headers.set('Cache-Control', 'no-cache');
  return new Response(html, { status: response.status, headers });
});
app.onError((err, c) => {
  console.error('Request failed', err.message);
  return c.json({ error: 'Request could not be completed' }, 500);
});
export { app };
