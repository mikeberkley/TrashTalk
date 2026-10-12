import { OpenRouterError } from './openrouter-error';
import {
  generateTrashTalk,
  trashStateKey,
  type TrashTalkJob,
} from './trash-talk';
import { generateShareImage, type ShareJob } from '../share-images';
import type { Env } from '../env';
import { room } from '../room-client';
import { runJob, type AIJob } from './openrouter';

type Outcome =
  | { status: 'complete'; result: Awaited<ReturnType<typeof runJob>> }
  | { status: 'failed' };
export const jobResultPrefix = '_job-results/';

// Keep completed results across queue redelivery so a callback outage does not
// repeat a paid generation. These JSON records are private to the worker.
export async function consumeJobs(
  batch: MessageBatch<AIJob | ShareJob | TrashTalkJob>,
  env: Env,
) {
  for (const message of batch.messages) {
    const job = message.body;
    if (job.kind === 'trash-talk') {
      const target = room(env, job.gameId);
      let claimed = false;
      try {
        const claim = await target.fetch(
          new Request(
            `https://room/trash-talk-claim?jobId=${encodeURIComponent(job.jobId)}`,
            { method: 'POST' },
          ),
        );
        if (!claim.ok) {
          message.retry({ delaySeconds: 60 });
          continue;
        }
        claimed = true;
        await generateTrashTalk(job, env);
        message.ack();
      } catch (error) {
        const provider = error instanceof OpenRouterError ? error : undefined;
        console.error('Trash Talk failed', {
          gameId: job.gameId,
          jobId: job.jobId,
          attempt: message.attempts,
          error: error instanceof Error ? error.message : 'Unknown error',
          ...(provider && {
            model: provider.model,
            status: provider.status,
            retryAfterSeconds: provider.retryAfterSeconds,
            ...provider.details,
          }),
        });
        // A failed generation ends this request. Only an explicit user action
        // can try again; never automatically repeat a paid model call.
        await env.ASSETS?.put(
          trashStateKey(job.jobId),
          JSON.stringify({
            status: 'failed',
            error:
              provider?.status === 429
                ? 'The image service is busy. Please try again later.'
                : 'Couldn’t finish this image. Please try again.',
          }),
        );
        message.ack();
      } finally {
        if (claimed) {
          try {
            await target.fetch(
              new Request(
                `https://room/trash-talk-release?jobId=${encodeURIComponent(job.jobId)}`,
                { method: 'POST' },
              ),
            );
          } catch {
            /* Lease expires; paid work is persisted. */
          }
        }
      }
      continue;
    }
    if (job.kind === 'share-image') {
      const target = room(env, job.gameId);
      let claimed = false;
      try {
        const claim = await target.fetch(
          new Request('https://room/share-claim', { method: 'POST' }),
        );
        if (!claim.ok) {
          message.retry({ delaySeconds: 60 });
          continue;
        }
        claimed = true;
        await generateShareImage(job, env);
        message.ack();
      } catch (error) {
        console.error(
          'Share image failed',
          job.gameId,
          error instanceof Error ? error.message : 'Unknown error',
        );
        if (!claimed || message.attempts < 2)
          message.retry({ delaySeconds: 30 });
        else message.ack(); // Activation performs bounded recovery; no infinite paid retries.
      } finally {
        if (claimed) {
          try {
            await target.fetch(
              new Request('https://room/share-release', { method: 'POST' }),
            );
          } catch {
            /* Lease expires automatically; saved images survive redelivery. */
          }
        }
      }
      continue;
    }
    const key = `${jobResultPrefix}${encodeURIComponent(job.gameId)}/${job.generation}/${encodeURIComponent(job.jobId)}.json`;
    try {
      const saved = await env.ASSETS?.get(key);
      let outcome = saved ? await saved.json<Outcome>() : undefined;
      if (!outcome) {
        try {
          outcome = { status: 'complete', result: await runJob(job, env) };
        } catch (error) {
          console.error(
            'AI generation failed',
            job.kind,
            error instanceof Error ? error.message : 'Unknown error',
          );
          if (message.attempts < 2) {
            message.retry({ delaySeconds: 10 });
            continue;
          }
          outcome = { status: 'failed' };
        }
        if (env.ASSETS)
          await env.ASSETS.put(key, JSON.stringify(outcome), {
            httpMetadata: { contentType: 'application/json' },
          });
      }
      const success = outcome.status === 'complete';
      const response = await room(env, job.gameId).fetch(
        new Request(`https://room/${success ? 'job-result' : 'job-failed'}`, {
          method: 'POST',
          body: JSON.stringify({
            generation: job.generation,
            jobId: job.jobId,
            kind: job.kind,
            scheduledAt:
              job.kind === 'storylines' ? job.scheduledAt : undefined,
            ...(outcome.status === 'complete'
              ? { result: outcome.result }
              : {}),
          }),
        }),
      );
      if (!response.ok) throw new Error(`Job delivery HTTP ${response.status}`);
      message.ack();
    } catch (error) {
      console.error(
        'AI result delivery failed',
        job.kind,
        error instanceof Error ? error.message : 'Unknown error',
      );
      // Delivery failures must never become generation failures or be acknowledged.
      message.retry({ delaySeconds: 10 });
    }
  }
}
