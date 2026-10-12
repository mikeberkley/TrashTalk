import { decode, encode } from "fast-png";
// Stable away-left/home-right transparent reference sheet. No resizing or palette alteration.
export function pairLogos(away: Uint8Array, home: Uint8Array) {
  const a = decode(away),
    h = decode(home);
  if (
    a.width !== 512 ||
    a.height !== 512 ||
    h.width !== 512 ||
    h.height !== 512 ||
    a.channels !== 4 ||
    h.channels !== 4
  )
    throw Error("Expected normalized 512px RGBA logos");
  const data = new Uint8Array(1024 * 512 * 4);
  for (let y = 0; y < 512; y++) {
    data.set(a.data.subarray(y * 512 * 4, (y + 1) * 512 * 4), y * 1024 * 4);
    data.set(
      h.data.subarray(y * 512 * 4, (y + 1) * 512 * 4),
      (y * 1024 + 512) * 4,
    );
  }
  return encode({ width: 1024, height: 512, data, channels: 4, depth: 8 });
}
