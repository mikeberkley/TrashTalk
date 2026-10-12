// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PosterShare } from '../apps/web/src/PosterShare';
import { initialSnapshot } from '../packages/sports-core/src';
vi.mock('../apps/web/src/posterFile', () => ({
  posterFile: async () =>
    new File(['image'], 'trash.png', { type: 'image/png' }),
  shareImageFile: vi.fn(),
}));
let root: Root;
const url =
  'https://www.fanlift.ai/games/nfl-123?trashTalk=nfl-123-1-home-image&score=17-45';
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
async function render(navigator: unknown) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', navigator);
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () =>
    root.render(
      React.createElement(PosterShare, {
        poster: {
          id: 'image',
          headline: 'Defense ate the group chat.',
          stat: 'Final',
          home: 0,
          away: 0,
          period: 0,
          clock: '',
          fallback: false,
        },
        game: initialSnapshot(),
        imageLabel: 'Trash Talk',
        shareUrl: url,
        shareTitle: 'Raiders 17 - 45 Patriots',
      }),
    ),
  );
  await act(async () =>
    el.querySelector<HTMLButtonElement>('.poster-share-trigger')!.click(),
  );
  return el;
}
it('shares a game link with a specific preview instead of an image attachment', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  await render({ share });
  expect(share).toHaveBeenCalledWith({
    title: 'Raiders 17 - 45 Patriots',
    url,
  });
});
it('copies the game link when native sharing is unavailable and retains download', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const el = await render({ clipboard: { writeText } });
  expect(writeText).toHaveBeenCalledWith(url);
  expect(el.textContent).toContain('Game link copied');
  expect(el.textContent).toContain('Download image');
});
it('provides a selectable game link when sharing and clipboard fail', async () => {
  const el = await render({
    share: vi.fn().mockRejectedValue(new Error('Unavailable')),
  });
  expect(el.querySelector('input')?.value).toBe(url);
});
