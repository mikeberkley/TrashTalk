import type { TrashTalkState } from '../../packages/trash-talk/src';
export const TRASH_TALK_INTERVAL = 3 * 60 * 1000;

// Called inside the visitor Durable Object's concurrency lock.
export async function trashTalkRate(
  request: Request,
  storage: DurableObjectStorage,
  forward: () => Promise<Response>,
  readJob: (jobId: string) => Promise<TrashTalkState | null>,
) {
  const storedNext = (await storage.get<number>('nextAvailableAt')) ?? 0;
  let nextAvailableAt = storedNext > Date.now() ? storedNext : 0;
  let active = await storage.get<{ jobId: string; startedAt: number } | null>(
    'activeTrashTalkJob',
  );
  if (active) {
    const state = await readJob(active.jobId);
    if (
      state?.status === 'complete' ||
      state?.status === 'failed' ||
      Date.now() - active.startedAt >= 10 * 60000
    ) {
      // Only a successfully generated image consumes the user's cooldown.
      nextAvailableAt =
        state?.status === 'complete'
          ? (Date.parse(state.result!.generatedAt) || Date.now()) +
            TRASH_TALK_INTERVAL
          : 0;
      await storage.put('nextAvailableAt', nextAvailableAt);
      await storage.put('activeTrashTalkJob', null);
      active = null;
    }
  }
  if (nextAvailableAt <= Date.now()) nextAvailableAt = 0;
  if (request.method === 'POST' && nextAvailableAt > Date.now())
    return Response.json(
      { error: 'You can generate one image every 3 minutes.', nextAvailableAt },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.ceil((nextAvailableAt - Date.now()) / 1000),
          ),
        },
      },
    );
  if (request.method === 'POST' && active)
    return Response.json(
      { error: 'Your image is still generating.', nextAvailableAt: 0 },
      { status: 409 },
    );
  const response = await forward();
  const jobId = response.headers.get('X-Trash-Talk-Job-Id');
  if (
    request.method === 'POST' &&
    response.headers.get('X-Trash-Talk-Started') === '1' &&
    jobId
  ) {
    await storage.put('activeTrashTalkJob', { jobId, startedAt: Date.now() });
    nextAvailableAt = 0;
  }
  const headers = new Headers(response.headers);
  headers.delete('X-Trash-Talk-Started');
  headers.delete('X-Trash-Talk-Job-Id');
  headers.set('Cache-Control', 'no-store');
  return Response.json(
    { ...((await response.json()) as object), nextAvailableAt },
    { status: response.status, headers },
  );
}
