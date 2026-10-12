import fs from "node:fs/promises";
import sharp from "sharp";

// Preserve the approved artwork; export sizes without changing the design.
const source = "design/logo/garbage-can-source.png";
const output = "apps/web/public";
for (const size of [16, 32, 48, 180, 192, 512]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(`${output}/trash-can-${size}.png`);
}

// Android maskable icons need the entire mark inside the central safe circle.
const inset = await sharp(source).resize(360, 360).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#101318" },
})
  .composite([{ input: inset, left: 76, top: 76 }])
  .png()
  .toFile(`${output}/trash-can-maskable-512.png`);

// ICO directory with PNG-backed entries for each browser favicon size.
const sizes = [16, 32, 48];
const images = await Promise.all(
  sizes.map((size) => fs.readFile(`${output}/trash-can-${size}.png`)),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((bytes, i) => {
  const entry = 6 + i * 16;
  header[entry] = sizes[i];
  header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await fs.writeFile(
  `${output}/trash-can-favicon.ico`,
  Buffer.concat([header, ...images]),
);
