import { afterEach, expect, it, vi } from 'vitest';
import { trashTalkRate } from '../worker/src/trash-talk-rate';
import type { TrashTalkState } from '../packages/trash-talk/src';
afterEach(() => vi.useRealTimers());
function setup() {
  const entries = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => entries.get(key),
    put: async (key: string, value: unknown) => {
      entries.set(key, value);
    },
  } as unknown as DurableObjectStorage;
  const forward = vi.fn(async () =>
    Response.json(
      { status: 'pending' },
      {
        status: 202,
        headers: {
          'X-Trash-Talk-Started': '1',
          'X-Trash-Talk-Job-Id': 'job-1',
        },
      },
    ),
  );
  const readJob = vi.fn(async (): Promise<TrashTalkState | null> => ({
    status: 'pending',
  }));
  const run = (method = 'POST') =>
    trashTalkRate(
      new Request('https://room/trash-talk-visitor', { method }),
      storage,
      forward,
      readJob,
    );
  return { run, forward, readJob, storage };
}
it('starts three minutes only on success and never extends it on polling or reload', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  const h = setup();
  const first = await h.run();
  expect(await first.json()).toMatchObject({ nextAvailableAt: 0 });
  expect(first.headers.get('X-Trash-Talk-Job-Id')).toBeNull();
  expect((await h.run()).status).toBe(409);
  vi.advanceTimersByTime(20000);
  h.readJob.mockResolvedValue({
    status: 'complete',
    result: { generatedAt: new Date().toISOString() } as any,
  });
  h.forward.mockImplementationOnce(async () =>
    Response.json({ status: 'complete' }),
  );
  expect(await (await h.run('GET')).json()).toMatchObject({
    nextAvailableAt: 1200000,
  });
  vi.advanceTimersByTime(179999);
  const blocked = await h.run();
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get('Retry-After')).toBe('1');
  expect(await (await h.run('GET')).json()).toMatchObject({
    nextAvailableAt: 1200000,
  });
  vi.advanceTimersByTime(1);
  expect((await h.run()).status).toBe(202);
});
it('allows an immediate explicit retry after generation fails, even without polling first', async () => {
  const h = setup();
  await h.run();
  h.readJob.mockResolvedValue({ status: 'failed', error: 'Service busy' });
  expect((await h.run()).status).toBe(202);
  expect(h.forward).toHaveBeenCalledTimes(2);
  expect(await (await h.run('GET')).json()).toMatchObject({
    nextAvailableAt: 0,
  });
});
it('does not charge failed starts or joining another generation; isolates visitors', async () => {
  const h = setup(),
    other = setup();
  h.forward.mockImplementationOnce(async () =>
    Response.json({ error: 'waiting' }, { status: 409 }),
  );
  expect((await h.run()).status).toBe(409);
  h.forward.mockImplementationOnce(async () =>
    Response.json({ status: 'pending' }, { status: 202 }),
  );
  expect(await (await h.run()).json()).toMatchObject({ nextAvailableAt: 0 });
  expect(h.readJob).not.toHaveBeenCalled();
  expect((await h.run()).status).toBe(202);
  expect((await other.run()).status).toBe(202);
});
it('does not leave a crashed generation blocking the visitor indefinitely', async () => {
  vi.useFakeTimers();
  const h = setup();
  await h.run();
  vi.advanceTimersByTime(600001);
  h.readJob.mockResolvedValue(null);
  expect((await h.run()).status).toBe(202);
});

it('reports zero for an expired legacy cooldown when a generation failed', async () => {
  const h = setup();
  await h.storage.put('nextAvailableAt', Date.now() - 1);
  h.forward.mockImplementationOnce(async () =>
    Response.json({ status: 'failed' }),
  );
  expect(await (await h.run('GET')).json()).toMatchObject({
    status: 'failed',
    nextAvailableAt: 0,
  });
});
