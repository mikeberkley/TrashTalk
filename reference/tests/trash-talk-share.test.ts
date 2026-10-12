import { expect, it, vi } from 'vitest';
import { app } from '../worker/src/routes';
import type { Env } from '../worker/src/env';
import { trashStateKey } from '../worker/src/jobs/trash-talk';
import { shareMetaKey } from '../worker/src/share-images';
const game = 'nfl-401872986';
const image = `${game}-1-away-example`;
function environment(extension = 'jpg') {
  const get = vi.fn(async (key: string) =>
    key === trashStateKey(image)
      ? {
          json: async () => ({
            status: 'complete',
            result: {
              text: 'Defense ate <the> group chat.',
              url: `/api/assets/trash-talk/${image}.${extension}`,
              label: 'Final · LV 17–NE 45',
            },
          }),
        }
      : key === shareMetaKey(game)
        ? {
            json: async () => ({
              title: 'Las Vegas Raiders vs. New England Patriots | FanLift',
            }),
          }
        : null,
  );
  return {
    get,
    env: {
      ASSETS: { get },
      WEB_ASSETS: {
        fetch: async () =>
          new Response(
            '<html><head><title>FanLift</title></head><body><div id="root"></div></body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          ),
      },
    } as unknown as Env,
  };
}
it.each(['jpg', 'png'])(
  'serves a specific Trash Talk %s preview at the game URL without JavaScript',
  async (extension) => {
    const { env } = environment(extension);
    const url = `https://www.fanlift.ai/games/${game}?trashTalk=${image}`;
    const response = await app.request(url, {}, env);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(
      `property="og:image" content="https://www.fanlift.ai/api/assets/trash-talk/${image}.${extension}"`,
    );
    expect(html).toContain(`property="og:url" content="${url}"`);
    expect(html).toContain('Defense ate &lt;the&gt; group chat.');
    expect(html).toContain('<title>Raiders vs Patriots</title>');
    expect(html).toContain('property="og:title" content="Raiders vs Patriots"');
    expect(html).toContain(
      'name="twitter:title" content="Raiders vs Patriots"',
    );
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<div id="root"></div>');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  },
);
it.each(['nfl-123-1-away-example', '../example', `${game}-missing`])(
  'does not use another game or a missing image as the preview: %s',
  async (imageId) => {
    const { env } = environment();
    const response = await app.request(
      `https://www.fanlift.ai/games/${game}?trashTalk=${encodeURIComponent(imageId)}`,
      {},
      env,
    );
    expect(await response.text()).not.toContain('og:image');
  },
);

it('keeps each shared preview tied to its original image when a new image is created', async () => {
  const second = `${game}-1-home-another-image`;
  const { env } = environment();
  const assets = env.ASSETS!;
  const firstGet = assets.get.bind(assets);
  assets.get = vi.fn(async (key: string) =>
    key === trashStateKey(second)
      ? {
          json: async () => ({
            status: 'complete',
            result: {
              text: 'A different roast.',
              label: 'Final',
              url: `/api/assets/trash-talk/${second}.png`,
            },
          }),
        }
      : firstGet(key),
  ) as typeof assets.get;
  const firstResponse = await app.request(
    `https://www.fanlift.ai/games/${game}?trashTalk=${image}`,
    {},
    env,
  );
  const secondResponse = await app.request(
    `https://www.fanlift.ai/games/${game}?trashTalk=${second}`,
    {},
    env,
  );
  expect(await firstResponse.text()).toContain(`/trash-talk/${image}.jpg`);
  expect(await secondResponse.text()).toContain(`/trash-talk/${second}.png`);
  const firstAgain = await app.request(
    `https://www.fanlift.ai/games/${game}?trashTalk=${image}`,
    {},
    env,
  );
  expect(await firstAgain.text()).toContain(`/trash-talk/${image}.jpg`);
});

it('uses the score captured when sharing in all page titles and the canonical preview URL', async () => {
  const { env } = environment();
  const url = `https://www.fanlift.ai/games/${game}?trashTalk=${image}&score=17-45`;
  const html = await (await app.request(url, {}, env)).text();
  expect(html).toContain('<title>Raiders 17 - 45 Patriots</title>');
  expect(html).toContain(
    'property="og:title" content="Raiders 17 - 45 Patriots"',
  );
  expect(html).toContain(
    'name="twitter:title" content="Raiders 17 - 45 Patriots"',
  );
  expect(html).toContain(
    `property="og:url" content="${url.replace('&', '&amp;')}"`,
  );
});
it.each(['bad', '-1-45', '17-45<script>'])(
  'ignores malformed share scores: %s',
  async (score) => {
    const { env } = environment();
    const html = await (
      await app.request(
        `https://www.fanlift.ai/games/${game}?trashTalk=${image}&score=${encodeURIComponent(score)}`,
        {},
        env,
      )
    ).text();
    expect(html).toContain('<title>Raiders vs Patriots</title>');
  },
);

it('keeps the pregame matchup and date captured when sharing', async () => {
  const { env } = environment();
  const url = `https://www.fanlift.ai/games/${game}?trashTalk=${image}&pregame=2026-10-12`;
  const html = await (await app.request(url, {}, env)).text();
  for (const tag of [
    '<title>Raiders vs Patriots on Mon Oct 12</title>',
    'property="og:title" content="Raiders vs Patriots on Mon Oct 12"',
    'name="twitter:title" content="Raiders vs Patriots on Mon Oct 12"',
  ])
    expect(html).toContain(tag);
  expect(html).toContain(
    `property="og:url" content="${url.replace('&', '&amp;')}"`,
  );
});
it.each(['bad', '2026-02-30', '2026-10-12<script>'])(
  'ignores invalid pregame dates: %s',
  async (day) => {
    const { env } = environment();
    const html = await (
      await app.request(
        `https://www.fanlift.ai/games/${game}?trashTalk=${image}&pregame=${encodeURIComponent(day)}`,
        {},
        env,
      )
    ).text();
    expect(html).toContain('<title>Raiders vs Patriots</title>');
  },
);
