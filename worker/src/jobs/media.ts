import { decode as pngDecode } from "fast-png";
import jpeg from "jpeg-js";
import type { Env } from "../env";
export function decodeImage(bytes: Uint8Array, max = 4096) {
  if (bytes.length > 10 * 1024 * 1024) throw Error("Image too large");
  let d: { width: number; height: number };
  let mime: string;
  if (
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.length < 24 ||
      view.getUint32(16) > max ||
      view.getUint32(20) > max ||
      view.getUint32(16) * view.getUint32(20) > 20000000
    )
      throw Error("Image dimensions too large");
    d = pngDecode(bytes, { checkCrc: true });
    mime = "image/png";
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    d = jpeg.decode(bytes, {
      maxResolutionInMP: 20,
      maxMemoryUsageInMB: 96,
      useTArray: true,
    });
    mime = "image/jpeg";
  } else
    throw Error(
      "Use a valid PNG or JPEG. Convert HEIC to JPEG on your phone before uploading.",
    );
  if (!d.width || !d.height || d.width > max || d.height > max)
    throw Error("Image dimensions too large");
  return { ...d, mime };
}
export function validateArtwork(bytes: Uint8Array) {
  if (bytes.length > 5 * 1024 * 1024) throw Error("Image exceeds 5 MiB");
  const d = decodeImage(bytes);
  if (d.width !== d.height || d.width < 600)
    throw Error("Image must be square, 600–4096 pixels");
  return d;
}
export function dataUrl(bytes: Uint8Array, mime: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function normalizeUpload(env: Env, bytes: Uint8Array) {
  const png =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpg = bytes[0] === 255 && bytes[1] === 216;
  if (!png && !jpg)
    throw Error(
      "Use PNG or JPEG. Convert HEIC to JPEG on your phone before uploading.",
    );
  // Cloudflare decodes the original off-isolate; only decode the bounded normalized result here.
  const stream = new Response(bytes as BodyInit).body!;
  const out = await env.IMAGES.input(stream)
    .transform({ width: 1600, height: 1600, fit: "scale-down" })
    .output({ format: "image/jpeg", quality: 90 });
  const b = new Uint8Array(await out.response().arrayBuffer());
  decodeImage(b, 1600);
  return b;
}
