import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { leagues } from "../packages/contracts/src/leagues";
import {
  getCatalogTeams,
  participant,
  catalogIdentity,
  catalogTeamDetail,
  getJson,
  scoreboardUrl,
} from "../worker/src/providers/espn";
const digest = (b: any) => createHash("sha256").update(b).digest("hex");
const dry = process.argv.includes("--dry-run"),
  local = process.argv.includes("--local"),
  remote = process.argv.includes("--remote");
const target =
  process.argv.find((x) => x.startsWith("--env="))?.split("=")[1] || "preview";
if (remote && target !== "preview" && target !== "production")
  throw Error("Invalid environment");
const selectedIds = process.argv
  .find((x) => x.startsWith("--leagues="))
  ?.split("=")[1]
  .split(",");
const selected = selectedIds
  ? leagues.filter((l) => selectedIds.includes(l.id))
  : leagues;
if (selectedIds && (selectedIds.length !== selected.length || !selected.length))
  throw Error("Unknown or duplicate league selection");
const dir =
  process.argv.find((x) => x.startsWith("--catalog-dir="))?.split("=")[1] ||
  "catalog-cache";
await fs.mkdir(dir, { recursive: true });
await fs.mkdir("reports", { recursive: true });
const q = (s: any) => "'" + String(s).replaceAll("'", "''") + "'";
const results: any[] = [];
const records = new Map<string, any>();
const statements: string[] = [];
for (const l of selected) {
  const leagueStatements: string[] = [];
  const row: any = {
    league: l.id,
    checkedAt: new Date().toISOString(),
    teams: 0,
    logos: 0,
    palettes: 0,
    gaps: [],
    games: 0,
  };
  try {
    const teams = await getCatalogTeams(l.id);
    row.teams = teams.length;
    row.selectableTeams = teams.filter((t) => !t.catalogOpponent).length;
    row.supportingOpponents = teams.filter((t) => t.catalogOpponent).length;
    const dates =
      l.id === "wnba"
        ? ["20261010", "20260815"]
        : l.id === "ncaaf"
          ? ["20261010", "20260919"]
          : l.id === "ucl"
            ? ["20260916", "20261020"]
            : l.id === "nfl"
              ? ["20261011", "20260118"]
              : l.id === "nba"
                ? ["20261010", "20260412"]
                : l.id === "mlb"
                  ? ["20261011", "20260704"]
                  : ["20261011", "20260919"];
    row.feedChecks = [];
    for (const date of dates) {
      const d = await getJson(scoreboardUrl(l, date));
      if (!Array.isArray(d.events)) throw Error("Invalid schedule feed");
      row.games += d.events.length;
      row.feedChecks.push({
        date,
        events: d.events.length,
        eventIds: d.events.map((e: any) => e.id),
      });
    }
    for (const seed of teams) {
      const id = participant(seed, l).id;
      try {
        // Team-detail endpoints expose palettes omitted by some list endpoints.
        const t = await catalogTeamDetail(seed, l);
        const color = (v: any) =>
          typeof v === "string" && /^[a-f\d]{6}$/i.test(v)
            ? "#" + v.toUpperCase()
            : null;
        const primary = color(t.color),
          secondary = color(t.alternateColor);
        if (!primary || !secondary)
          row.gaps.push({ team: id, kind: "palette", primary, secondary });
        else row.palettes++;
        const source = t.logos?.[0]?.href;
        if (!source) throw Error("No source logo");
        const filename = `${dir}/${digest(source)}.original`;
        let original: Buffer;
        try {
          original = await fs.readFile(filename);
        } catch {
          const r = await fetch(source, { signal: AbortSignal.timeout(15000) });
          if (!r.ok) throw Error("Logo download failed");
          original = Buffer.from(await r.arrayBuffer());
          await fs.writeFile(filename, original);
        }
        if (original.length > 10 * 1024 * 1024) throw Error("Logo too large");
        const png = await sharp(original, { limitInputPixels: 20000000 })
          .rotate()
          .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .ensureAlpha()
          .png()
          .toBuffer();
        const decoded = await sharp(png)
          .raw()
          .toBuffer({ resolveWithObject: true });
        let transparent = false;
        for (let i = 3; i < decoded.data.length; i += 4)
          if (decoded.data[i] < 255) {
            transparent = true;
            break;
          }
        if (!transparent) throw Error("Logo lacks transparent background");
        const logoHash = digest(png),
          paletteHash = digest(JSON.stringify({ primary, secondary })),
          version = digest(logoHash + paletteHash),
          logoKey = `branding/${id}/${version}.png`,
          originalKey = `originals/${id}/${digest(original)}`;
        const metadata = {
          ...catalogIdentity(t, l),
          primary,
          secondary,
          paletteSource: t.paletteSource,
          sourceUrl: source,
          sourceHash: digest(original),
          checkedAt: row.checkedAt,
          retrievedAt: row.checkedAt,
          mime: "image/png",
          width: 512,
          height: 512,
          transparent,
          attribution:
            "Team/league trademarks; ESPN-distributed branding. Rights review required for commercial use.",
          version,
          logoKey,
          logoHash,
          paletteHash,
          originalKey,
        };
        await fs.writeFile(`${dir}/${logoHash}.png`, png);
        row.logos++;
        records.set(id, {
          metadata,
          pngPath: `${dir}/${logoHash}.png`,
          originalPath: filename,
        });
        if (!dry) {
          leagueStatements.push(
            `INSERT OR IGNORE INTO team_versions VALUES(${[id, version, logoKey, logoHash, paletteHash, JSON.stringify(metadata)].map(q).join(",")});`,
            `INSERT INTO teams VALUES(${q(id)},${q(JSON.stringify(metadata))},${q(version)}) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,active_version=excluded.active_version;`,
          );
          if (!t.catalogOpponent)
            leagueStatements.push(
              `INSERT OR IGNORE INTO memberships VALUES(${q(l.id)},${q(id)});`,
            );
        }
      } catch (e) {
        row.gaps.push({ team: id, kind: "asset", error: String(e) });
      }
    }
    row.ready = row.teams > 0 && row.gaps.length === 0 && row.games > 0;
  } catch (e) {
    row.gaps.push({ kind: "feed", error: String(e) });
    row.ready = false;
  }
  results.push(row);
  if (row.ready) statements.push(...leagueStatements);
  console.log(
    JSON.stringify({
      league: row.league,
      teams: row.teams,
      logos: row.logos,
      palettes: row.palettes,
      games: row.games,
      gaps: row.gaps.length,
      ready: row.ready,
    }),
  );
  statements.push(
    `INSERT INTO leagues VALUES(${q(l.id)},${row.ready ? 1 : 0},${q(row.checkedAt)},${q(JSON.stringify(row))}) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,checked_at=excluded.checked_at,report=excluded.report;`,
  );
}
let previous: any[] = [];
try {
  previous = JSON.parse(
    await fs.readFile("reports/catalog-coverage.json", "utf8"),
  );
} catch {}
const coverage = new Map(previous.map((row) => [row.league, row]));
for (const row of results) coverage.set(row.league, row);
await fs.writeFile(
  "reports/catalog-coverage.json",
  JSON.stringify([...coverage.values()], null, 2),
);
await fs.writeFile(`${dir}/coverage.json`, JSON.stringify(results, null, 2));
await fs.writeFile(
  `${dir}/records.json`,
  JSON.stringify([...records.values()], null, 2),
);
await fs.writeFile(`${dir}/catalog.sql`, statements.join("\n"));
if ((remote || local) && !dry) {
  if (results.some((row) => !row.ready))
    throw Error("Catalog not ready for publication");
  const run = (args: string[]) =>
    execFileSync("npx", ["wrangler", ...args, "--env", target], {
      stdio: "pipe",
      maxBuffer: 4 * 1024 * 1024,
    });
  for (const { metadata: m, pngPath, originalPath } of records.values()) {
    run([
      "r2",
      "object",
      "put",
      `trashtalk-${target}-media/${m.logoKey}`,
      "--file",
      pngPath,
      "--content-type",
      "image/png",
      remote ? "--remote" : "--local",
    ]);
    run([
      "r2",
      "object",
      "put",
      `trashtalk-${target}-media/${m.originalKey}`,
      "--file",
      originalPath,
      remote ? "--remote" : "--local",
    ]);
  }
  run([
    "d1",
    "execute",
    `trashtalk-${target}`,
    "--file",
    `${dir}/catalog.sql`,
    remote ? "--remote" : "--local",
  ]);
}
