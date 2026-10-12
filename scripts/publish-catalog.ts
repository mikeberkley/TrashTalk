import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const remote = process.argv.includes("--remote"),
  env =
    process.argv.find((x) => x.startsWith("--env="))?.split("=")[1] ||
    "preview";
const records = JSON.parse(
  await fs.readFile("catalog-cache/records.json", "utf8"),
);
const run = (args: string[]) =>
  execFileSync("npx", ["wrangler", ...args, "--env", env], {
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  });
let complete = 0;
const readbacks = [];
for (const { metadata: m, pngPath, originalPath } of records) {
  for (const [key, path, mime] of [
    [m.logoKey, pngPath, "image/png"],
    [m.originalKey, originalPath, "application/octet-stream"],
  ]) {
    run([
      "r2",
      "object",
      "put",
      `trashtalk-${env}-media/${key}`,
      "--file",
      path,
      "--content-type",
      mime,
      remote ? "--remote" : "--local",
    ]);
  }
  const check = `catalog-cache/readback.png`;
  run([
    "r2",
    "object",
    "get",
    `trashtalk-${env}-media/${m.logoKey}`,
    "--file",
    check,
    remote ? "--remote" : "--local",
  ]);
  const actual = createHash("sha256")
    .update(await fs.readFile(check))
    .digest("hex");
  if (actual !== m.logoHash) throw Error("R2 readback failed: " + m.id);
  readbacks.push({ id: m.id, hash: actual, verified: true });
  if (++complete % 20 === 0)
    console.log(
      `Published and read back ${complete}/${records.length} team assets`,
    );
}
run([
  "d1",
  "execute",
  `trashtalk-${env}`,
  "--file",
  "catalog-cache/catalog.sql",
  remote ? "--remote" : "--local",
]);
await fs.writeFile(
  `reports/r2-${remote ? "remote" : "local"}-readback.json`,
  JSON.stringify(readbacks, null, 2),
);
console.log(`Catalog activated after ${complete} successful R2 hash readbacks`);
