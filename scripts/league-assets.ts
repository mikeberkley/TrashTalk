import fs from "node:fs/promises";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { leagues } from "../packages/contracts/src/leagues";
import { getJson, scoreboardUrl } from "../worker/src/providers/espn";
import { cf } from "./cloudflare";

const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const ids = process.argv
  .find((x) => x.startsWith("--leagues="))
  ?.split("=")[1]
  .split(",");
const selected = ids ? leagues.filter((l) => ids.includes(l.id)) : leagues;
if (!selected.length || (ids && ids.length !== selected.length))
  throw Error("Invalid leagues");
const dir =
  process.argv.find((x) => x.startsWith("--catalog-dir="))?.split("=")[1] ||
  "catalog-cache";
const report = [],
  sql = [];
for (const l of selected) {
  const d = await getJson(scoreboardUrl(l));
  const source = d.leagues?.[0]?.logos?.[0]?.href;
  if (!source) throw Error(`League logo unavailable: ${l.id}`);
  const r = await fetch(source);
  if (!r.ok) throw Error("League logo fetch failed");
  const original = Buffer.from(await r.arrayBuffer());
  const png = await sharp(original)
    .resize(256, 256, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .png()
    .toBuffer();
  const version = hash(png),
    key = `league-branding/${l.id}/${version}.png`;
  const originalKey = `originals/leagues/${l.id}/${hash(original)}`;
  for (const env of ["preview", "production"]) {
    await cf(
      `/r2/buckets/trashtalk-${env}-media/objects/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: png,
        headers: { "Content-Type": "image/png" },
      },
    );
    await cf(
      `/r2/buckets/trashtalk-${env}-media/objects/${encodeURIComponent(originalKey)}`,
      {
        method: "PUT",
        body: original,
      },
    );
    const back = await cf(
      `/r2/buckets/trashtalk-${env}-media/objects/${encodeURIComponent(key)}`,
    );
    if (hash(Buffer.from(await back.arrayBuffer())) !== version)
      throw Error("Readback mismatch");
  }
  const metadata = {
    league: l.id,
    source,
    originalKey,
    hash: version,
    width: 256,
    height: 256,
    checkedAt: new Date().toISOString(),
    ready: true,
  };
  report.push(metadata);
  sql.push(
    `INSERT OR REPLACE INTO league_assets VALUES(${[l.id, version, key, JSON.stringify(metadata)].map(quote).join(",")});`,
  );
}
await fs.writeFile(
  `${dir}/league-assets.json`,
  JSON.stringify(report, null, 2),
);
await fs.writeFile(`${dir}/league-assets.sql`, sql.join("\n"));
console.log(report.map((x) => ({ league: x.league, ready: x.ready })));
