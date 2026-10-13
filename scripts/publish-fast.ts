import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { cf } from "./cloudflare";
const env = process.argv.includes("--production") ? "production" : "preview";
const dir =
  process.argv.find((x) => x.startsWith("--catalog-dir="))?.split("=")[1] ||
  "catalog-cache";
const records = JSON.parse(await fs.readFile(`${dir}/records.json`, "utf8"));
const coverage = JSON.parse(await fs.readFile(`${dir}/coverage.json`, "utf8"));
if (!coverage.length || coverage.some((row: any) => !row.ready))
  throw Error("Catalog not ready for publication");
const report: any[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (cursor < records.length) {
      const r = records[cursor++],
        m = r.metadata;
      for (const [key, path, mime] of [
        [m.logoKey, r.pngPath, "image/png"],
        [m.originalKey, r.originalPath, "application/octet-stream"],
      ]) {
        const route = `/r2/buckets/trashtalk-${env}-media/objects/${encodeURIComponent(key)}`;
        await cf(route, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: await fs.readFile(path),
        });
      }
      const back = await cf(
        `/r2/buckets/trashtalk-${env}-media/objects/${encodeURIComponent(m.logoKey)}`,
      );
      const actual = createHash("sha256")
        .update(Buffer.from(await back.arrayBuffer()))
        .digest("hex");
      if (actual !== m.logoHash) throw Error("Hash mismatch");
      report.push({ id: m.id, hash: actual, verified: true });
      if (report.length % 30 === 0)
        console.log("Stored and verified", report.length, "/", records.length);
    }
  }),
);
await fs.writeFile(
  `${dir}/r2-${env}-readback.json`,
  JSON.stringify(report, null, 2),
);
console.log("All assets verified; metadata ready for D1 import");
