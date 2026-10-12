import { afterEach, expect, it, vi } from 'vitest';
import { consumeJobs } from '../worker/src/jobs/queue';
import {
  generateTrashTalk,
  trashStateKey,
  type TrashTalkJob,
} from '../worker/src/jobs/trash-talk';
import { OpenRouterError } from '../worker/src/jobs/openrouter-error';
import type { Env } from '../worker/src/env';
vi.mock('../worker/src/jobs/trash-talk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../worker/src/jobs/trash-talk')>()),
  generateTrashTalk: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
function setup() {
  const records = new Map<string, string>();
  const job = {
    kind: 'trash-talk',
    gameId: 'nfl-test',
    jobId: 'trash-1',
    contextKey: 'key',
    context: {},
  } as TrashTalkJob;
  const roomFetch = vi.fn(async () => new Response('{}'));
  const env = {
    GAME_ROOMS: {
      idFromName: (id: string) => id,
      get: () => ({ fetch: roomFetch }),
    },
    ASSETS: {
      put: async (key: string, value: string) => {
        records.set(key, value);
      },
    },
  } as unknown as Env;
  const message = { body: job, attempts: 1, ack: vi.fn(), retry: vi.fn() };
  return {
    records,
    job,
    roomFetch,
    message,
    run: () =>
      consumeJobs(
        { messages: [message] } as unknown as MessageBatch<TrashTalkJob>,
        env,
      ),
  };
}
it.each([
  new OpenRouterError(429, 'image-model', 1800, { provider: 'Google' }),
  new OpenRouterError(503, 'image-model', undefined, {}),
  new Error('Invalid image'),
  new Error('Caption generation timed out'),
])(
  'stops after the first generation failure without automatic retries: %s',
  async (error) => {
    const h = setup();
    vi.mocked(generateTrashTalk).mockRejectedValue(error);
    await h.run();
    expect(generateTrashTalk).toHaveBeenCalledOnce();
    expect(h.message.retry).not.toHaveBeenCalled();
    expect(h.message.ack).toHaveBeenCalledOnce();
    const state = JSON.parse(h.records.get(trashStateKey(h.job.jobId))!);
    expect(state.status).toBe('failed');
    expect(state.error).toContain(
      error instanceof OpenRouterError && error.status === 429
        ? 'image service is busy'
        : 'Couldn’t finish',
    );
    expect(state).not.toHaveProperty('retryAt');
    expect(h.roomFetch.mock.calls).toHaveLength(2);
  },
);
it('acknowledges successful generation without a retry', async () => {
  const h = setup();
  vi.mocked(generateTrashTalk).mockResolvedValue(undefined);
  await h.run();
  expect(h.message.ack).toHaveBeenCalledOnce();
  expect(h.message.retry).not.toHaveBeenCalled();
});
