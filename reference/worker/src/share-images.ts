import type { Snapshot } from '../../packages/contracts/src';
import type { Env } from './env';
import { completion } from './jobs/openrouter';
export const shareKey = (id: string, version = 1) =>
  `share/v${version}/${id}.png`;
export const introKey = (id: string, version = 1) =>
  `intro/v${version}/${id}.png`;
export const shareMetaKey = (id: string) => `share/v1/${id}.json`;
export type ShareJob = {
  kind: 'share-image';
  gameId: string;
  home: Snapshot['home'];
  away: Snapshot['away'];
};
export type ShareMetadata = {
  imageVersion?: number;
  introVersion?: number;
  title: string;
  description: string;
  alt: string;
  width: number;
  height: number;
};
export function sharePrompt(job: ShareJob) {
  return `Create a premium, HIGH-ENERGY square 1:1 NFL matchup social graphic. Composition: HEAD TO HEAD. Two enormous realistic football helmets, equal size and height, inward-facing three-quarter profile across a narrow glowing central gap. Away team LEFT: ${job.away.city} ${job.away.name} (${job.away.abbr}), colors ${job.away.color}, ${job.away.secondaryColor ?? job.away.color}. Home team RIGHT: ${job.home.city} ${job.home.name} (${job.home.abbr}), colors ${job.home.color}, ${job.home.secondaryColor ?? job.home.color}. Use each team's authentic standard helmet shell, facemask and supplied official logo faithfully; do not invent helmet colors from the team palette. In particular SF uses a metallic GOLD shell with RED facemask (never a red shell), TB a PEWTER shell with BLACK facemask, DAL a SILVER shell with GRAY facemask, ATL a BLACK shell with BLACK facemask, NE a SILVER shell with RED facemask, LV a SILVER shell with BLACK facemask, SEA a NAVY shell with NAVY facemask, NO a GOLD shell with BLACK facemask; logos prominently visible. Background smoothly merges the two team palettes left to right with smoky gradients, electric light at the center, controlled sparks, outward speed streaks, glossy cinematic rim lighting. Symmetric, instantly readable at thumbnail size. Helmets occupy upper two thirds. Exact sole added text below: "Follow on FanLift.ai" in large bold clean white typography, centered with generous safe margins. No app icon or app logo, players, scores, dates, other text, watermarks or borders. Full bleed. Keep both helmets and all text inside safe margins.`;
}
export async function ensureShareImage(
  storage: DurableObjectStorage,
  env: Env,
  s: Snapshot,
) {
  if (
    s.mode !== 'live' ||
    !env.ASSETS ||
    !env.AI_JOBS ||
    !env.OPENROUTER_API_KEY
  )
    return;
  const meta = await (
    await env.ASSETS.get(shareMetaKey(s.id))
  )?.json<ShareMetadata>();
  if (meta?.introVersion) return;
  const previous = await storage.get<{ at: number; attempts: number }>(
    'shareImagePairV1',
  );
  if (
    previous &&
    (previous.attempts >= 3 || Date.now() - previous.at < 20 * 60000)
  )
    return;
  await env.AI_JOBS.send({
    kind: 'share-image',
    gameId: s.id,
    home: s.home,
    away: s.away,
  });
  await storage.put('shareImagePairV1', {
    at: Date.now(),
    attempts: (previous?.attempts ?? 0) + 1,
  });
}
export function pngDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 24 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    throw Error('Share image must be PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (width !== height || width < 600 || width > 4096)
    throw Error('Share image must be square, 600–4096 pixels');
  return { width, height };
}
async function generateSocialImage(job: ShareJob, env: Env) {
  if (!env.ASSETS) throw Error('Share image storage unavailable');
  if (await env.ASSETS.head(shareMetaKey(job.gameId))) return;
  // Persist the paid image before metadata, so a retry after publication failure reuses it.
  let object = await env.ASSETS.get(shareKey(job.gameId));
  let bytes: Uint8Array;
  if (object) bytes = new Uint8Array(await object.arrayBuffer());
  else {
    const data = await completion(
      env,
      {
        model: env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3-pro-image',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: sharePrompt(job) },
              ...[job.away, job.home]
                .filter((t) => t.logo)
                .map((t) => ({
                  type: 'image_url',
                  image_url: { url: t.logo },
                })),
            ],
          },
        ],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: '1:1', image_size: '1K' },
      },
      120000,
    );
    const image = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const match =
      typeof image === 'string' && /^data:image\/png;base64,(.+)$/.exec(image);
    if (!match) throw Error('No PNG share image returned');
    bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    if (bytes.length > 5 * 1024 * 1024) throw Error('Share image exceeds 5 MB');
    pngDimensions(bytes);
    await env.ASSETS.put(shareKey(job.gameId), bytes, {
      httpMetadata: {
        contentType: 'image/png',
        cacheControl: 'public,max-age=31536000,immutable',
      },
    });
  }
  const matchup = `${job.away.city} ${job.away.name} vs. ${job.home.city} ${job.home.name}`;
  const meta: ShareMetadata = {
    title: `${matchup} | FanLift`,
    description:
      'Follow the game, expert reactions, and every shift in momentum on FanLift.',
    alt: `${matchup} helmets facing off. Follow on FanLift.ai`,
    ...pngDimensions(bytes),
  };
  await env.ASSETS.put(shareMetaKey(job.gameId), JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  });
}
export const introPrompt = `Edit this square NFL matchup graphic for the Game Center entrance. Remove only the added promotional text "Follow on FanLift.ai" and fill that area seamlessly with the existing high-energy smoky gradient, lighting and sparks. Preserve both helmets, their authentic colors, team logos and helmet lettering, their positions, lighting and the square composition. No added text, slogans, app logos, borders or watermarks. Do not crop or distort the helmets.`;

export async function generateShareImage(job: ShareJob, env: Env) {
  await generateSocialImage(job, env);
  const assets = env.ASSETS!;
  const meta = await (await assets.get(
    shareMetaKey(job.gameId),
  ))!.json<ShareMetadata>();
  if (meta.introVersion) return;
  // Save each paid variant independently; retries never regenerate a saved image.
  if (!(await assets.head(introKey(job.gameId)))) {
    const source = await assets.get(
      shareKey(job.gameId, meta.imageVersion ?? 1),
    );
    if (!source) throw Error('Intro source image unavailable');
    const bytes = new Uint8Array(await source.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const data = await completion(
      env,
      {
        model: env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3-pro-image',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: introPrompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${btoa(binary)}` },
              },
            ],
          },
        ],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: '1:1', image_size: '1K' },
      },
      120000,
    );
    const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const match =
      typeof url === 'string' && /^data:image\/png;base64,(.+)$/.exec(url);
    if (!match) throw Error('No PNG intro image returned');
    const result = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    if (result.length > 5 * 1024 * 1024)
      throw Error('Intro image exceeds 5 MB');
    pngDimensions(result);
    await assets.put(introKey(job.gameId), result, {
      httpMetadata: {
        contentType: 'image/png',
        cacheControl: 'public,max-age=31536000,immutable',
      },
    });
  }
  await assets.put(
    shareMetaKey(job.gameId),
    JSON.stringify({ ...meta, introVersion: 1 }),
    {
      httpMetadata: { contentType: 'application/json' },
    },
  );
}
export const escapeHTML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function shareTags(
  origin: string,
  id: string,
  m: ShareMetadata,
  preview?: { image: string; url: string; contentType: string },
) {
  const image =
    preview?.image ??
    `${origin}/share-images/${id}/v${m.imageVersion ?? 1}.png`;
  const tags = {
    'og:type': 'website',
    'og:site_name': 'FanLift',
    'og:title': m.title,
    'og:description': m.description,
    'og:url': preview?.url ?? `${origin}/games/${id}`,
    'og:image': image,
    'og:image:secure_url': image,
    'og:image:type': preview?.contentType ?? 'image/png',
    'og:image:width': String(m.width),
    'og:image:height': String(m.height),
    'og:image:alt': m.alt,
  };
  return (
    `<meta name="description" content="${escapeHTML(m.description)}">` +
    Object.entries(tags)
      .map(
        ([key, value]) =>
          `<meta property="${key}" content="${escapeHTML(value)}">`,
      )
      .join('') +
    Object.entries({
      'twitter:card': 'summary_large_image',
      'twitter:title': m.title,
      'twitter:description': m.description,
      'twitter:image': image,
      'twitter:image:alt': m.alt,
    })
      .map(
        ([key, value]) => `<meta name="${key}" content="${escapeHTML(value)}">`,
      )
      .join('')
  );
}
