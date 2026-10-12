import { pngDimensions } from '../share-images';
export function trashTalkImage(url: unknown) {
  const match =
    typeof url === 'string' && /^data:image\/(png|jpeg);base64,(.+)$/.exec(url);
  if (!match || match[2].length > 7 * 1024 * 1024)
    throw Error('No supported square image');
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 5 * 1024 * 1024) throw Error('Image too large');
  if (match[1] === 'png') {
    pngDimensions(bytes);
    return { bytes, extension: 'png', contentType: 'image/png' };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217 || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) {
        const height = view.getUint16(offset + 3),
          width = view.getUint16(offset + 5);
        if (width !== height || width < 600 || width > 4096)
          throw Error('Trash Talk image must be square, 600–4096 pixels');
        return { bytes, extension: 'jpg', contentType: 'image/jpeg' };
      }
      offset += length;
    }
  }
  throw Error('Invalid JPEG image');
}
