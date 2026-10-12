import { afterEach, expect, it, vi } from 'vitest';
import { initialSnapshot } from '../packages/sports-core/src';
import type { Play } from '../packages/contracts/src';
import { trashTalkContext, trashTalkKey } from '../packages/trash-talk/src';
import {
  generateTrashTalk,
  trashTalkRequest,
  trashStateKey,
  type TrashTalkJob,
} from '../worker/src/jobs/trash-talk';
import { completion, imageGeneration } from '../worker/src/jobs/openrouter';
import type { Env } from '../worker/src/env';
vi.mock('../worker/src/jobs/openrouter', () => ({
  completion: vi.fn(),
  imageGeneration: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
function setup() {
  const objects = new Map<string, any>(),
    entries = new Map<string, any>();
  const env = {
    OPENROUTER_API_KEY: 'test',
    AI_JOBS: { send: vi.fn() },
    ASSETS: {
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
        truncated: false,
      })),
      get: async (key: string) =>
        objects.has(key)
          ? { json: async () => JSON.parse(objects.get(key)) }
          : null,
      head: async (key: string) => (objects.has(key) ? {} : null),
      put: vi.fn(async (key: string, value: any) => {
        objects.set(key, value);
      }),
    },
  } as unknown as Env;
  const storage = {
    list: async ({ prefix }: { prefix: string }) =>
      new Map([...entries].filter(([key]) => key.startsWith(prefix))),
    get: async (key: string) => entries.get(key),
    put: async (key: string, value: any) => {
      entries.set(key, value);
    },
  } as unknown as DurableObjectStorage;
  const s = initialSnapshot();
  s.status = 'live';
  const request = (side: unknown = 'home', method = 'POST') =>
    new Request(`https://room/trash-talk?side=${side}`, {
      method,
      ...(method === 'POST' ? { body: JSON.stringify({ side }) } : {}),
    });
  return { env, storage, s, request, entries, objects };
}
function play(id: string, clock: string, extra: Partial<Play> = {}): Play {
  return {
    id,
    eventId: id,
    occurredAt: null,
    sequence: 1,
    revision: 1,
    team: 'home',
    kind: 'play',
    text: 'A play',
    period: 1,
    clock,
    ...extra,
  };
}
it('uses latest briefing pregame, newest real big play live, and actual final results', () => {
  const { s } = setup();
  s.plays = [
    play('td', '10:00', { kind: 'score', text: 'Touchdown', sequence: 99 }),
    play('pat', '9:59', { kind: 'score', text: 'Extra point good' }),
    play('sack', '8:00', { sack: true }),
    play('void', '7:00', { kind: 'turnover', noPlay: true }),
    play('hidden', '6:00', { kind: 'score', hidden: true }),
    play('reversed', '5:00', { kind: 'score', text: 'Touchdown reversed' }),
  ];
  expect(trashTalkContext(s, 'away').moment?.id).toBe('sack');
  const key = trashTalkKey(s, 'home');
  s.clock = '3:00';
  expect(trashTalkKey(s, 'home')).toBe(key);
  s.plays[2].revision++;
  expect(trashTalkKey(s, 'home')).not.toBe(key);
  s.status = 'scheduled';
  s.storylines = {
    generatedAt: new Date().toISOString(),
    scheduledAt: s.scheduledAt,
    cards: [],
  };
  expect(trashTalkContext(s, 'home')).toMatchObject({
    briefing: s.storylines,
    score: null,
    moment: undefined,
  });
  s.status = 'final';
  s.homeScore = 7;
  s.awayScore = 21;
  expect(trashTalkContext(s, 'home')).toMatchObject({
    score: { home: 7, away: 21 },
    moment: undefined,
    briefing: undefined,
  });
});
it('validates favorite, waits for briefing, deduplicates requests, and isolates perspectives', async () => {
  const h = setup();
  expect(
    (await trashTalkRequest(h.request(null), h.s, h.env, h.storage)).status,
  ).toBe(400);
  h.s.status = 'scheduled';
  expect(
    (await trashTalkRequest(h.request(), h.s, h.env, h.storage)).status,
  ).toBe(409);
  h.s.status = 'live';
  expect(
    (await trashTalkRequest(h.request(), h.s, h.env, h.storage)).status,
  ).toBe(202);
  await trashTalkRequest(h.request(), h.s, h.env, h.storage);
  expect(h.env.AI_JOBS!.send).toHaveBeenCalledTimes(1);
  await trashTalkRequest(h.request('away'), h.s, h.env, h.storage);
  expect(h.env.AI_JOBS!.send).toHaveBeenCalledTimes(2);
  h.s.generation++;
  expect(
    await (
      await trashTalkRequest(h.request('home', 'GET'), h.s, h.env, h.storage)
    ).json(),
  ).toEqual({ status: 'idle', images: [] });
});
it('allows explicit retries of failed or timed-out jobs', async () => {
  vi.useFakeTimers();
  const h = setup();
  await trashTalkRequest(h.request(), h.s, h.env, h.storage);
  vi.advanceTimersByTime(600001);
  expect(
    await (
      await trashTalkRequest(h.request('home', 'GET'), h.s, h.env, h.storage)
    ).json(),
  ).toMatchObject({ status: 'failed' });
  await trashTalkRequest(h.request(), h.s, h.env, h.storage);
  vi.advanceTimersByTime(600001);
  await trashTalkRequest(h.request(), h.s, h.env, h.storage);
  vi.advanceTimersByTime(600001);
  expect(
    (await trashTalkRequest(h.request(), h.s, h.env, h.storage)).status,
  ).toBe(202);
  expect(h.env.AI_JOBS!.send).toHaveBeenCalledTimes(4);
});
function png(width = 1024, height = 1024) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}
it.each(['png', 'jpg'])(
  'uses Grok then a square %s image, persists paid stages, and skips caption review',
  async (format) => {
    const h = setup();
    h.s.away.logo = 'https://example.com/away.png';
    h.s.home.logo = 'https://example.com/home.png';
    await trashTalkRequest(h.request(), h.s, h.env, h.storage);
    const job = vi.mocked(h.env.AI_JOBS!.send).mock.calls[0][0] as TrashTalkJob;
    vi.mocked(completion).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              text: 'Your defense left the group chat.',
              visual: 'Opponent helmet dramatically evaporates into pixels.',
            }),
          },
        },
      ],
    });
    vi.mocked(imageGeneration).mockRejectedValueOnce(
      Error('temporary failure'),
    );
    await expect(generateTrashTalk(job, h.env)).rejects.toThrow(
      'temporary failure',
    );
    const imageUrl =
      format === 'png'
        ? png()
        : 'data:image/jpeg;base64,' +
          btoa(
            String.fromCharCode(
              ...[
                255, 216, 255, 192, 0, 11, 8, 4, 0, 4, 0, 1, 1, 17, 0, 255, 217,
              ],
            ),
          );
    vi.mocked(imageGeneration).mockResolvedValueOnce({
      data: [
        {
          b64_json: imageUrl.split(',')[1],
          media_type: format === 'png' ? 'image/png' : 'image/jpeg',
        },
      ],
    });
    await generateTrashTalk(job, h.env);
    expect(vi.mocked(completion).mock.calls[0][1]).toMatchObject({
      model: 'x-ai/grok-4.3',
    });
    expect(vi.mocked(imageGeneration).mock.calls[1][1]).toMatchObject({
      model: 'x-ai/grok-imagine-image-2.0',
      input_references: [
        { type: 'image_url', image_url: { url: h.s.away.logo } },
        { type: 'image_url', image_url: { url: h.s.home.logo } },
      ],
      quality: 'medium',
      resolution: '1K',
      aspect_ratio: '1:1',
      n: 1,
      provider: { only: ['xai'], allow_fallbacks: false },
    });
    await generateTrashTalk(job, h.env);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(imageGeneration).toHaveBeenCalledTimes(2);
    expect(JSON.parse(h.objects.get(trashStateKey(job.jobId)))).toMatchObject({
      status: 'complete',
      result: {
        text: 'Your defense left the group chat.',
        url: `/api/assets/trash-talk/${job.jobId}.${format}`,
      },
    });
    expect(
      (await trashTalkRequest(h.request(), h.s, h.env, h.storage)).status,
    ).toBe(429);
    expect(h.env.AI_JOBS!.send).toHaveBeenCalledTimes(1);
  },
);
it('rejects malformed or non-square image output before publication', async () => {
  const h = setup();
  await trashTalkRequest(h.request(), h.s, h.env, h.storage);
  const job = vi.mocked(h.env.AI_JOBS!.send).mock.calls[0][0] as TrashTalkJob;
  vi.mocked(completion).mockResolvedValueOnce({
    choices: [
      {
        message: {
          content: '{"text":"Zero chill.","visual":"A helmet on a throne."}',
        },
      },
    ],
  });
  vi.mocked(imageGeneration).mockResolvedValueOnce({
    data: [{ b64_json: png(1024, 768).split(',')[1] }],
  });
  await expect(generateTrashTalk(job, h.env)).rejects.toThrow('square');
  expect(JSON.parse(h.objects.get(trashStateKey(job.jobId))).status).toBe(
    'pending',
  );
});
it('recovers all existing images once, separates teams, and preserves history across new requests', async () => {
  vi.useFakeTimers();
  const h = setup();
  const image = (id: string, time: string) => ({
    text: id,
    url: `/api/assets/trash-talk/${id}.png`,
    label: 'Pregame briefing',
    generatedAt: time,
    contextKey: 'old',
  });
  const old = image('older', '2026-10-11T12:00:00Z');
  const recent = image('recent', '2026-10-11T13:00:00Z');
  const prefix = `${h.s.id}-${h.s.generation}-home-`;
  h.objects.set(
    trashStateKey(prefix + 'first'),
    JSON.stringify({ status: 'complete', result: old }),
  );
  h.objects.set(
    trashStateKey(prefix + 'second'),
    JSON.stringify({ status: 'complete', result: recent }),
  );
  h.objects.set(
    trashStateKey(`${h.s.id}-${h.s.generation}-away-other`),
    JSON.stringify({
      status: 'complete',
      result: image('other', '2026-10-11T14:00:00Z'),
    }),
  );
  const read = async () =>
    (
      await trashTalkRequest(h.request('home', 'GET'), h.s, h.env, h.storage)
    ).json() as Promise<any>;
  expect((await read()).images.map((i: any) => i.text)).toEqual([
    'older',
    'recent',
  ]);
  await read();
  expect(h.env.ASSETS!.list).toHaveBeenCalledTimes(1);
  const started = (await (
    await trashTalkRequest(h.request(), h.s, h.env, h.storage)
  ).json()) as any;
  expect(started.images).toHaveLength(2);
  const job = vi.mocked(h.env.AI_JOBS!.send).mock.calls[0][0] as TrashTalkJob;
  const newest = {
    ...image('newest', '2026-10-11T15:00:00Z'),
    contextKey: job.contextKey,
  };
  h.objects.set(
    trashStateKey(job.jobId),
    JSON.stringify({ status: 'complete', result: newest }),
  );
  expect((await read()).images.map((i: any) => i.text)).toEqual([
    'older',
    'recent',
    'newest',
  ]);
  expect((await read()).images[2]).not.toHaveProperty('contextKey');
  vi.advanceTimersByTime(60001);
  const next = (await (
    await trashTalkRequest(h.request(), h.s, h.env, h.storage)
  ).json()) as any;
  expect(next.status).toBe('pending');
  expect(next.images).toHaveLength(3);
  const nextJob = vi.mocked(h.env.AI_JOBS!.send).mock
    .calls[1][0] as TrashTalkJob;
  expect(nextJob.jobId).not.toBe(job.jobId);
  expect(nextJob.contextKey).toBe(job.contextKey);
});

it('does not mark a failed legacy history scan as complete', async () => {
  const h = setup();
  vi.mocked(h.env.ASSETS!.list).mockRejectedValueOnce(
    Error('storage unavailable'),
  );
  await expect(
    trashTalkRequest(h.request('home', 'GET'), h.s, h.env, h.storage),
  ).rejects.toThrow('storage unavailable');
  expect(h.entries.has(`trash-history-ready:${h.s.generation}:home`)).toBe(
    false,
  );
  expect(
    (await trashTalkRequest(h.request('home', 'GET'), h.s, h.env, h.storage))
      .status,
  ).toBe(200);
});

it('does not restart a failed generation on queue redelivery', async () => {
  const h = setup();
  await trashTalkRequest(h.request(), h.s, h.env, h.storage);
  const job = vi.mocked(h.env.AI_JOBS!.send).mock.calls[0][0] as TrashTalkJob;
  h.objects.set(
    trashStateKey(job.jobId),
    JSON.stringify({ status: 'failed', error: 'Service busy' }),
  );
  await generateTrashTalk(job, h.env);
  expect(completion).not.toHaveBeenCalled();
});

it('allows the user to retry a known failure immediately without the old per-game cooldown', async () => {
  const h = setup();
  await trashTalkRequest(h.request(), h.s, h.env, h.storage);
  const job = vi.mocked(h.env.AI_JOBS!.send).mock.calls[0][0] as TrashTalkJob;
  h.objects.set(trashStateKey(job.jobId), JSON.stringify({ status: 'failed' }));
  expect(
    (await trashTalkRequest(h.request(), h.s, h.env, h.storage)).status,
  ).toBe(202);
  expect(h.env.AI_JOBS!.send).toHaveBeenCalledTimes(2);
});

it.each(['two words', 'SHIT', 'fuuuck', 'f*ck', 'a'.repeat(31), null, 42])(
  'rejects invalid optional words before queueing: %s',
  async (includeWord) => {
    const h = setup();
    const response = await trashTalkRequest(
      new Request('https://room/trash-talk', {
        method: 'POST',
        body: JSON.stringify({ side: 'home', includeWord }),
      }),
      h.s,
      h.env,
      h.storage,
    );
    expect(response.status).toBe(400);
    expect(h.env.AI_JOBS!.send).not.toHaveBeenCalled();
    expect(h.env.ASSETS!.put).not.toHaveBeenCalled();
  },
);
it('keeps different words out of the same pending or cached job', async () => {
  const h = setup();
  const post = (includeWord: string) =>
    trashTalkRequest(
      new Request('https://room/trash-talk', {
        method: 'POST',
        body: JSON.stringify({ side: 'home', includeWord }),
      }),
      h.s,
      h.env,
      h.storage,
    );
  expect((await post('banana')).status).toBe(202);
  const first = vi.mocked(h.env.AI_JOBS!.send).mock.calls[0][0] as TrashTalkJob;
  expect(first.includeWord).toBe('banana');
  expect((await post('waffle')).status).toBe(409);
  h.objects.set(
    trashStateKey(first.jobId),
    JSON.stringify({ status: 'failed' }),
  );
  expect((await post('waffle')).status).toBe(202);
  const second = vi.mocked(h.env.AI_JOBS!.send).mock
    .calls[1][0] as TrashTalkJob;
  expect(second.jobId).not.toBe(first.jobId);
  expect(second.contextKey).not.toBe(first.contextKey);
  expect(second.includeWord).toBe('waffle');
});
it.each(['Your defense slipped on a BANANA.', 'Your defense looks bananas.'])(
  'only renders artwork when the caption includes the exact word: %s',
  async (caption) => {
    const h = setup();
    await trashTalkRequest(
      new Request('https://room/trash-talk', {
        method: 'POST',
        body: JSON.stringify({ side: 'home', includeWord: 'banana' }),
      }),
      h.s,
      h.env,
      h.storage,
    );
    const job = vi.mocked(h.env.AI_JOBS!.send).mock.calls[0][0] as TrashTalkJob;
    vi.mocked(completion).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              text: caption,
              visual: 'A banana helmet.',
            }),
          },
        },
      ],
    });
    vi.mocked(imageGeneration).mockResolvedValue({
      data: [{ b64_json: png().split(',')[1] }],
    });
    if (caption.includes('BANANA')) {
      await generateTrashTalk(job, h.env);
      expect(imageGeneration).toHaveBeenCalledOnce();
      expect(JSON.parse(h.objects.get(trashStateKey(job.jobId))).status).toBe(
        'complete',
      );
    } else {
      await expect(generateTrashTalk(job, h.env)).rejects.toThrow(
        'requested word',
      );
      expect(imageGeneration).not.toHaveBeenCalled();
      expect(
        h.objects.has(`_job-results/trash-talk/${job.jobId}-text.json`),
      ).toBe(false);
    }
    expect(JSON.stringify(vi.mocked(completion).mock.calls[0][1])).toContain(
      'Required caption word',
    );
  },
);
