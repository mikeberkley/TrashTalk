// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TrashTalk } from '../apps/web/src/TrashTalk';
import { initialSnapshot } from '../packages/sports-core/src';
import { trashTalkKey } from '../packages/trash-talk/src';
let root: ReturnType<typeof createRoot>;
const exportContext = {
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
};
let exportCanvas: HTMLCanvasElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1024;
      naturalHeight = 1024;
      onload?: () => void;
      set src(_value: string) {
        this.onload?.();
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    function (this: HTMLCanvasElement) {
      exportCanvas = this;
      return exportContext as unknown as CanvasRenderingContext2D;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(new Blob(['export'], { type: 'image/png' })),
  );

  document.body.innerHTML = '<div id="test"></div>';
  root = createRoot(document.getElementById('test')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});
it('generates only on demand and resumes polling until the share overlay is ready', async () => {
  vi.useFakeTimers();
  const s = initialSnapshot();
  s.status = 'live';
  let generated = false;
  const mock = vi.fn(async (_url: any, init?: RequestInit) => {
    if (String(_url).startsWith('/api/assets/'))
      return new Response(new Blob(['png'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      });
    if (init?.method === 'POST') {
      generated = true;
      return Response.json({ status: 'pending' });
    }
    return Response.json(
      generated
        ? {
            status: 'complete',
            result: {
              text: 'The defense left the group chat.',
              url: '/api/assets/trash-talk/test.png',
              label: 'Q1 · 8:00',
              contextKey: trashTalkKey(s, 'home'),
              generatedAt: '',
            },
          }
        : { status: 'idle' },
    );
  });
  vi.stubGlobal('fetch', mock);
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'home', delay: 0 })),
  );
  expect(mock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.trash-talk-generate')!.click(),
  );
  expect(document.querySelector('input')).not.toBeNull();
  expect(mock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(mock.mock.calls.find((c) => c[1]?.method === 'POST')?.[1]?.body).toBe(
    '{"side":"home"}',
  );
  expect(
    document.querySelector('.trash-talk-art img')?.getAttribute('alt'),
  ).toBe('The defense left the group chat.');
  const share = document.querySelector<HTMLButtonElement>(
    '.trash-talk-art .poster-share-trigger',
  )!;
  expect(share.getAttribute('aria-label')).toBe('Share Trash Talk image');
  expect(share.disabled).toBe(false);
  const openImage = document.querySelector<HTMLImageElement>(
    '.poster-stack-front .trash-talk-image',
  )!;
  openImage.focus();
  await act(async () => openImage.click());
  expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  expect(document.querySelector('dialog img')?.getAttribute('src')).toBe(
    '/api/assets/trash-talk/test.png',
  );
  expect(document.body.style.overflow).toBe('hidden');
  const fullScreenShare = document.querySelector<HTMLButtonElement>(
    'dialog .poster-share-trigger',
  )!;
  expect(fullScreenShare.textContent).toBe('Share');
  const previousNavigator = navigator;
  const nativeShare = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share: nativeShare });
  await act(async () => fullScreenShare.click());
  expect(nativeShare).toHaveBeenCalledWith({
    title: `${s.away.name} ${s.awayScore} - ${s.homeScore} ${s.home.name}`,
    url: `https://www.fanlift.ai/games/${s.id}?trashTalk=test&score=${s.awayScore}-${s.homeScore}`,
  });
  expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  vi.stubGlobal('navigator', previousNavigator);
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close image"]')!
      .click(),
  );
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(openImage);
  await act(async () =>
    openImage.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  expect(document.querySelector('dialog')).not.toBeNull();
  await act(async () =>
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel')),
  );
  expect(document.querySelector('dialog')).toBeNull();
  await act(async () => openImage.click());
  const viewer = document.querySelector('dialog')!;
  const pointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, {
      pointerId: 1,
      isPrimary: true,
      clientX: x,
      clientY: y,
    });
    return event;
  };
  await act(async () => {
    viewer.dispatchEvent(pointer('pointerdown', 100, 100));
    viewer.dispatchEvent(pointer('pointerup', 110, 110));
  });
  expect(document.querySelector('dialog')).not.toBeNull();
  await act(async () => {
    viewer.dispatchEvent(pointer('pointerdown', 100, 100));
    viewer.dispatchEvent(pointer('pointerup', 100, 180));
  });
  expect(document.querySelector('dialog')).toBeNull();
  expect(exportCanvas.width).toBe(1024);
  expect(exportCanvas.height).toBe(1085);
  expect(exportContext.drawImage).toHaveBeenCalledWith(
    expect.anything(),
    0,
    0,
    1024,
    1024,
  );
  expect(exportContext.fillRect).toHaveBeenCalledWith(0, 1024, 1024, 61);
  expect(exportContext.fillText).toHaveBeenCalledWith(
    'Shared from FanLift.ai',
    512,
    1054.5,
    921.6,
  );

  await act(async () => share.click());
  expect(document.querySelector('dialog')).toBeNull();
  expect(
    document.querySelector('.trash-talk-art .poster-share-options')
      ?.textContent,
  ).toContain('Download image');
  expect(
    document.querySelector<HTMLButtonElement>('.trash-talk-generate')!.disabled,
  ).toBe(false);
  expect(document.querySelector('.trash-talk-caption')).toBeNull();
  expect(document.querySelector('.trash-talk-generate')?.textContent).toContain(
    'Generate new trash talk',
  );
  const calls = mock.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(12000));
  expect(mock).toHaveBeenCalledTimes(calls);
});
it('requires a favorite and blocks spoiler generation while broadcast delay is active', async () => {
  const s = initialSnapshot();
  s.status = 'live';
  const mock = vi.fn(async () => Response.json({ status: 'idle' }));
  vi.stubGlobal('fetch', mock);
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: null, delay: 0 })),
  );
  expect(document.querySelector<HTMLButtonElement>('button')!.disabled).toBe(
    true,
  );
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'home', delay: 30 })),
  );
  expect(document.body.textContent).toContain('Switch off broadcast delay');
  expect(mock).toHaveBeenCalledTimes(2);
});
it('discards a pending response after the favorite changes', async () => {
  const s = initialSnapshot();
  s.status = 'live';
  let resolve!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: any, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>((r) => (resolve = r))
        : Response.json({ status: 'idle' }),
    ),
  );
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'home', delay: 0 })),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button')!.click(),
  );
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'away', delay: 0 })),
  );
  await act(async () =>
    resolve(
      Response.json({
        status: 'complete',
        result: { text: 'Old favorite response', url: '/old.png' },
      }),
    ),
  );
  expect(document.body.textContent).not.toContain('Old favorite response');
  expect(document.body.textContent).toContain(s.away.name);
});

it('browses saved images with arrows and keyboard while keeping the new-generation button below them', async () => {
  const s = initialSnapshot();
  s.status = 'live';
  const images = [
    {
      text: 'Old roast',
      url: '/api/assets/old.png',
      label: 'Q1 · 10:00',
      generatedAt: '1',
    },
    {
      text: 'New roast',
      url: '/api/assets/new.png',
      label: 'Q2 · 5:00',
      generatedAt: '2',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any) =>
      String(url).startsWith('/api/assets/')
        ? new Response(new Blob(['png'], { type: 'image/png' }), {
            headers: { 'Content-Type': 'image/png' },
          })
        : Response.json({
            status: 'complete',
            images,
            result: { ...images[1], contextKey: 'k' },
          }),
    ),
  );
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'home', delay: 0 })),
  );
  const activeImage = () =>
    document.querySelector('.poster-stack-front img')?.getAttribute('alt');
  expect(activeImage()).toBe('New roast');
  expect(document.body.textContent).not.toContain('New roast');
  expect(document.body.textContent).toContain('Image 1 of 2');
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Older image"]')!
      .click(),
  );
  expect(activeImage()).toBe('Old roast');
  expect(document.body.textContent).toContain('Image 2 of 2');
  await act(async () =>
    document
      .querySelector('.poster-stack')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      ),
  );
  expect(activeImage()).toBe('New roast');
  const carousel = document.querySelector('.poster-stack')!,
    actions = document.querySelector('.trash-talk-actions')!;
  expect(
    carousel.compareDocumentPosition(actions) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(document.querySelector('.trash-talk-heading button')).toBeNull();
});

it('restores the server cooldown on reload and enables generation at three minutes', async () => {
  vi.useFakeTimers();
  const s = initialSnapshot();
  s.status = 'live';
  const mock = vi.fn(async () =>
    Response.json({ status: 'idle', nextAvailableAt: Date.now() + 180000 }),
  );
  vi.stubGlobal('fetch', mock);
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'home', delay: 0 })),
  );
  const button = document.querySelector<HTMLButtonElement>(
    '.trash-talk-generate',
  )!;
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('3:00');
  await act(async () => vi.advanceTimersByTimeAsync(179000));
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('0:01');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(button.disabled).toBe(false);
  expect(button.textContent).toContain('Talk trash');
  expect(mock).toHaveBeenCalledTimes(1);
});

it('validates the optional word, supports cancel, and sends a valid word on submit', async () => {
  const s = initialSnapshot();
  s.status = 'live';
  const mock = vi.fn(async (_url: any, init?: RequestInit) =>
    Response.json({ status: init?.method === 'POST' ? 'pending' : 'idle' }),
  );
  vi.stubGlobal('fetch', mock);
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'home', delay: 0 })),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.trash-talk-generate')!.click(),
  );
  expect(document.activeElement).toBe(document.querySelector('input'));
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.trash-talk-cancel')!.click(),
  );
  expect(document.querySelector('input')).toBeNull();
  expect(mock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.trash-talk-generate')!.click(),
  );
  const input = document.querySelector('input')!;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!;
  for (const value of ['two words', 'SHIT', 'banana']) {
    await act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    );
    if (value !== 'banana') {
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
      expect(mock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
    }
  }
  expect(
    mock.mock.calls
      .filter((c) => c[1]?.method === 'POST')
      .map((c) => JSON.parse(String(c[1]?.body))),
  ).toEqual([{ side: 'home', includeWord: 'banana' }]);
});

it('browses both teams in neutral, refreshes new images, and only permits generation after choosing a team', async () => {
  vi.useFakeTimers();
  const s = initialSnapshot();
  s.status = 'live';
  const images = [
    {
      text: 'Home roast',
      url: '/api/assets/neutral-home.png',
      label: 'Q1',
      generatedAt: '2026-10-11T17:00:00Z',
    },
    {
      text: 'Away roast',
      url: '/api/assets/neutral-away.png',
      label: 'Q2',
      generatedAt: '2026-10-11T18:00:00Z',
    },
    {
      text: 'Newest home roast',
      url: '/api/assets/neutral-new.png',
      label: 'Q3',
      generatedAt: '2026-10-11T19:00:00Z',
    },
  ];
  let newImage = false;
  const fetcher = vi.fn(async (url: any) => {
    if (String(url).startsWith('/api/assets/'))
      return new Response(new Blob(['png'], { type: 'image/png' }), {
        headers: { 'Content-Type': 'image/png' },
      });
    const home = String(url).includes('side=home');
    const history = home
      ? newImage
        ? [images[0], images[2]]
        : [images[0]]
      : [images[1]];
    return Response.json({
      status: 'complete',
      images: history,
      result: { ...history.at(-1), contextKey: 'k' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: null, delay: 0 })),
  );
  const activeImage = () =>
    document.querySelector('.poster-stack-front img')?.getAttribute('alt');
  expect(activeImage()).toBe('Away roast');
  expect(document.body.textContent).toContain('Image 1 of 2');
  expect(
    document.querySelector<HTMLButtonElement>('.trash-talk-generate')!.disabled,
  ).toBe(true);
  expect(
    fetcher.mock.calls.some((c) => String(c[0]).includes('side=home')),
  ).toBe(true);
  expect(
    fetcher.mock.calls.some((c) => String(c[0]).includes('side=away')),
  ).toBe(true);
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Older image"]')!
      .click(),
  );
  expect(activeImage()).toBe('Home roast');
  newImage = true;
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(document.body.textContent).toContain('of 3');
  await act(async () =>
    root.render(React.createElement(TrashTalk, { s, side: 'away', delay: 0 })),
  );
  expect(activeImage()).toBe('Away roast');
  expect(
    document.querySelector<HTMLButtonElement>('.trash-talk-generate')!.disabled,
  ).toBe(false);
});
