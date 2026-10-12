import {
  OpenRouterError,
  providerDetails,
  retryAfterSeconds,
} from './openrouter-error';
import { z } from 'zod';
import type { Poster } from '../../../packages/contracts/src';
import { runFanJob, type FanJob } from './fan';
import { posterContent, posterContext, posterPrompt } from './poster';
import {
  runPressConferenceJob,
  type PressConferenceJob,
} from './press-conferences';
import { runStorylineJob, type StorylineJob } from './storylines';
export type AIJob =
  | PressConferenceJob
  | FanJob
  | StorylineJob
  | {
      kind: 'poster' | 'explanation';
      gameId: string;
      generation: number;
      jobId: string;
      poster?: Poster;
      context: ReturnType<typeof posterContext>;
    };
export interface ModelEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_TEXT_MODEL?: string;
  OPENROUTER_IMAGE_MODEL?: string;
  OPENROUTER_REVIEW_MODEL?: string;
  POSTER_REVIEW_ENABLED?: string;
  ASSETS?: R2Bucket;
}
export function completion(env: ModelEnv, body: object, timeout = 80000) {
  return openRouterRequest(env, 'chat/completions', body, timeout);
}
export function imageGeneration(env: ModelEnv, body: object, timeout = 120000) {
  return openRouterRequest(env, 'images', body, timeout);
}
async function openRouterRequest(
  env: ModelEnv,
  endpoint: 'chat/completions' | 'images',
  body: object,
  timeout: number,
) {
  if (!env.OPENROUTER_API_KEY) throw new Error('OpenRouter is not configured');
  const r = await fetch(`https://openrouter.ai/api/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://games.lost2038.com',
      'X-Title': 'FanLift',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) {
    const failure = (await r.json().catch(() => null)) as any;
    throw new OpenRouterError(
      r.status,
      'model' in body ? String(body.model) : 'unknown',
      retryAfterSeconds(r.headers.get('Retry-After')),
      providerDetails(failure?.error, env.OPENROUTER_API_KEY),
    );
  }
  const data = (await r.json()) as any;
  if (data.error) throw new Error('OpenRouter generation failed');
  return data;
}
const model = (env: ModelEnv) =>
  env.OPENROUTER_TEXT_MODEL ?? 'openai/gpt-4.1-mini';
export async function runJob(job: AIJob, env: ModelEnv) {
  if (job.kind === 'press-conferences') return runPressConferenceJob(job, env);
  if (job.kind === 'fan') return runFanJob(job, env);
  if (job.kind === 'storylines') return runStorylineJob(job, env);
  if (job.kind === 'poster') {
    const p = job.poster!;
    const prompt = posterPrompt(p, job.context);
    const data = await completion(env, {
      model: env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3-pro-image',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...[job.context.away, job.context.home]
              .filter((t) => t.logo)
              .map((t) => ({ type: 'image_url', image_url: { url: t.logo } })),
          ],
        },
      ],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '3:4', image_size: '1K' },
    });
    const image = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (
      typeof image !== 'string' ||
      !/^data:image\/(png|jpeg|webp);base64,/.test(image)
    )
      throw new Error('No supported image returned');
    // Review can be paused without removing the validation path.
    if (env.POSTER_REVIEW_ENABLED !== 'false') {
      const review = await completion(
        env,
        {
          model: env.OPENROUTER_REVIEW_MODEL ?? 'openai/gpt-5.4-mini',
          reasoning: { effort: 'low' },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Inspect this finished poster. Measure only text against the FULL canvas, ignoring artwork, frames and logo edges. ${posterContent(p, job.context)} Reject any unauthorized Monday Night Football/MNF label. For pregame, reject any game score or records not directly beneath the corresponding logo. For live reject FINAL; for postgame require FINAL. Check factual accuracy, legibility, faithful presence of BOTH official logos (${job.context.away.city} ${job.context.away.name} and ${job.context.home.city} ${job.context.home.name}), and team colors ${job.context.away.color} / ${job.context.home.color}. Estimate the smallest whitespace margin from any text glyph to each canvas edge as a fraction of image width/height. A letter touching the top has topMargin 0, even if technically legible. Return JSON {"valid":boolean,"teamBranding":boolean,"topMargin":number,"bottomMargin":number,"leftMargin":number,"rightMargin":number}. valid must be false for any missing, misspelled, clipped or incorrect required content, any GAME ANALYZER branding/footer, or any white border, paper mat or outer frame. Artwork must extend to all four edges. Do not give a passing margin simply because no letters are clipped.`,
                },
                { type: 'image_url', image_url: { url: image } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1200,
        },
        40000,
      );
      const check = z
        .object({
          valid: z.boolean(),
          teamBranding: z.boolean(),
          topMargin: z.number().min(0).max(1),
          bottomMargin: z.number().min(0).max(1),
          leftMargin: z.number().min(0).max(1),
          rightMargin: z.number().min(0).max(1),
        })
        .parse(JSON.parse(review.choices[0].message.content));
      if (
        !check.valid ||
        !check.teamBranding ||
        check.topMargin < 0.05 ||
        Math.min(check.bottomMargin, check.leftMargin, check.rightMargin) < 0.03
      )
        throw new Error(
          'Poster content, branding, or margin validation failed',
        );
    }
    if (!env.ASSETS) throw new Error('Poster storage is unavailable');
    const [, mime, base64] =
      /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image)!;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    if (bytes.length > 12 * 1024 * 1024)
      throw new Error('Image exceeds size limit');
    const key = `${job.gameId}/${job.generation}/${job.jobId}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
    await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: mime } });
    return {
      type: 'poster.published',
      payload: {
        ...p,
        fallback: false,
        artworkOnly: false,
        url: `/api/assets/${key}`,
      },
    };
  }
  const facts = JSON.stringify(job.context);
  const data = await completion(
    env,
    {
      model: model(env),
      messages: [
        {
          role: 'system',
          content:
            'You are a concise sports analyst. Use ONLY supplied captured facts. Never infer injury diagnosis, player names, weather, causes, or predictions. Explain the latest pivotal event in 1-2 short sentences. Return JSON with headline, body, supportingEventIds. Every claim must be directly supported by the supplied facts.',
        },
        { role: 'user', content: facts },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 350,
    },
    25000,
  );
  const result = z
    .object({
      headline: z.string().max(120),
      body: z.string().max(500),
      supportingEventIds: z.array(z.string()).min(1),
    })
    .parse(JSON.parse(data.choices[0].message.content));
  if (
    result.supportingEventIds.some(
      (id) => !job.context.plays.some((p) => p.eventId === id),
    )
  )
    throw new Error('Unsupported event citation');
  const check = await completion(
    env,
    {
      model: model(env),
      messages: [
        {
          role: 'user',
          content: `Verify ALL claims (names, numbers, causal claims, game impact) in the proposed explanation against the facts. Reject anything inferred or unsupported. Return {"supported":true} or {"supported":false}. FACTS: ${facts}\nPROPOSED: ${JSON.stringify(result)}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 100,
    },
    20000,
  );
  if (
    !z
      .object({ supported: z.boolean() })
      .parse(JSON.parse(check.choices[0].message.content)).supported
  )
    throw new Error('Explanation validation failed');
  return {
    type: 'explanation.published',
    payload: { id: job.jobId, ...result },
  };
}
