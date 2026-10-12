import type { Poster, Snapshot } from '../../../packages/contracts/src';
export async function shareImageFile(
  file: File,
  shareNavigator: Pick<Navigator, 'share' | 'canShare'> = navigator,
) {
  const data: ShareData = { files: [file] };
  if (!shareNavigator.share || !shareNavigator.canShare?.(data)) return false;
  await shareNavigator.share(data);
  return true;
}
const files = new Map<string, File>();
export async function posterFile(
  p: Poster,
  s: Snapshot,
  signal: AbortSignal,
  shareFooter?: string,
): Promise<File> {
  const key = JSON.stringify([
    p,
    s.away.abbr,
    s.home.abbr,
    s.away.color,
    s.home.color,
    s.away.logo,
    s.home.logo,
    shareFooter,
  ]);
  const cached = files.get(key);
  if (cached) return cached;
  const original = await createPosterFile(p, s, signal);
  const file = shareFooter
    ? await addShareFooter(original, shareFooter)
    : original;
  if (files.size >= 12) files.delete(files.keys().next().value!);
  files.set(key, file);
  return file;
}
// Prepare before the click so native sharing retains the user's activation.
async function addShareFooter(file: File, text: string): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(Error('Image export unavailable'));
      image.src = url;
    });
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height) throw Error('Invalid image dimensions');
    const footerHeight = Math.max(32, Math.round(width * 0.06));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height + footerHeight;
    const c = canvas.getContext('2d');
    if (!c) throw Error('Image export unavailable');
    c.drawImage(image, 0, 0, width, height);
    c.fillStyle = '#000000';
    c.fillRect(0, height, width, footerHeight);
    c.fillStyle = '#ffffff';
    c.font = `500 ${Math.round(footerHeight * 0.42)}px Arial, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, width / 2, height + footerHeight / 2, width * 0.9);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error('Image export unavailable'))),
        'image/png',
      ),
    );
    return new File([blob], file.name.replace(/\.[^.]+$/, '.png'), {
      type: 'image/png',
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function createPosterFile(
  p: Poster,
  s: Snapshot,
  signal: AbortSignal,
): Promise<File> {
  const name = `${s.away.abbr}-${s.home.abbr}-${p.id}`;
  if (p.url && p.artworkOnly === false) {
    const r = await fetch(p.url, { signal });
    if (!r.ok) throw Error('Image unavailable');
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) throw Error('Invalid image');
    const ext = blob.type.includes('jpeg')
      ? 'jpg'
      : blob.type.includes('webp')
        ? 'webp'
        : 'png';
    return new File([blob], `${name}.${ext}`, { type: blob.type });
  }
  // Export the deterministic fallback as a PNG too: sharing never substitutes a page URL.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1365;
  const c = canvas.getContext('2d');
  if (!c) throw Error('Image export unavailable');
  await document.fonts.ready;
  const gradient = c.createLinearGradient(0, 0, 1024, 1365);
  gradient.addColorStop(0, s.away.color);
  gradient.addColorStop(1, s.home.color);
  c.fillStyle = gradient;
  c.fillRect(0, 0, 1024, 1365);
  c.fillStyle = '#0b1018d9';
  c.fillRect(0, 0, 1024, 1365);
  c.fillStyle = '#dbe2e9';
  c.font = '24px Barlow, sans-serif';
  c.fillText('GAME STORY', 96, 112);
  c.textAlign = 'right';
  c.fillText(
    p.phase === 'post'
      ? 'FINAL'
      : p.period
        ? `${p.period > 4 ? 'OT' : `Q${p.period}`} · ${p.clock}`
        : 'PREGAME',
    928,
    112,
  );
  c.textAlign = 'left';
  const words = p.headline.toUpperCase().split(/\s+/);
  let lines: string[] = [];
  let size = 90;
  do {
    c.font = `700 ${size}px "Barlow Condensed", sans-serif`;
    lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && c.measureText(next).width > 832) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length * size <= 290) break;
    size -= 4;
  } while (size > 30);
  c.fillStyle = '#ffffff';
  lines.forEach((line, i) => c.fillText(line, 96, 226 + i * size * 1.02));
  async function logo(url: string | undefined, x: number) {
    if (!url) return;
    const r = await fetch(url, { signal });
    if (!r.ok) throw Error('Team logo unavailable');
    const blob = await r.blob(),
      objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(Error('Team logo unavailable'));
        image.src = objectUrl;
      });
      c!.drawImage(image, x, 535, 280, 280);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  await logo(s.away.logo, 128);
  await logo(s.home.logo, 616);
  c.textAlign = 'center';
  if (p.phase === 'pre' || !p.period) {
    c.fillStyle = '#fff';
    c.font = '28px Barlow, sans-serif';
    c.fillText(p.awayRecord ?? s.away.record, 268, 852);
    c.fillText(p.homeRecord ?? s.home.record, 756, 852);
  }
  c.font = '700 66px "Barlow Condensed", sans-serif';
  c.fillStyle = '#fff';
  c.fillText(s.away.abbr, 268, 905);
  c.fillText(s.home.abbr, 756, 905);
  c.font = '28px Barlow, sans-serif';
  c.fillText(p.period ? '—' : 'VS', 512, 704);
  if (p.period) {
    c.font = '700 92px "Barlow Condensed", sans-serif';
    c.fillText(String(p.away), 268, 1030);
    c.fillText(String(p.home), 756, 1030);
  }
  c.font = '30px Barlow, sans-serif';
  c.fillText(p.stat, 512, 1130, 832);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error('Image export unavailable'))),
      'image/png',
    ),
  );
  return new File([blob], `${name}.png`, { type: 'image/png' });
}
