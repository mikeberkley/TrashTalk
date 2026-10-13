import { decode } from "fast-png";
import { leagues } from "../../packages/contracts/src/leagues";
import {
  getCatalogTeams,
  catalogTeamDetail,
  catalogIdentity,
} from "./providers/espn";
import { type Env, sql, hash, now } from "./env";
export async function refreshLeague(env: Env, id: string) {
  const l = leagues.find((l) => l.id === id);
  if (!l) throw Error("Unknown league");
  const checkedAt = new Date().toISOString(),
    gaps: any[] = [],
    staged: any[] = [];
  const teams = await getCatalogTeams(id);
  for (const seed of teams) {
    try {
      const t = await catalogTeamDetail(seed, l);
      const identity = catalogIdentity(t, l),
        primary = hex(t.color),
        secondary = hex(t.alternateColor);
      if (!primary || !secondary) throw Error("Missing verified palette");
      const sourceUrl = t.logos?.[0]?.href;
      if (
        !sourceUrl ||
        !/^https:\/\/(a\.espncdn\.com|a\d?\.espncdn\.com)\//.test(sourceUrl)
      )
        throw Error("Logo source needs manual review");
      const fetched = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(12000),
      });
      if (!fetched.ok) throw Error("Logo fetch failed");
      const original = new Uint8Array(await fetched.arrayBuffer());
      if (original.length > 10 * 1024 * 1024) throw Error("Logo too large");
      const sourceHash = await hash(original);
      const current = await sql(
        env,
        "SELECT metadata FROM teams WHERE id=?",
        identity.id,
      ).first<{ metadata: string }>();
      const prior = current ? JSON.parse(current.metadata) : null;
      let logoHash: string, logoKey: string, version: string;
      const paletteHash = await hash(JSON.stringify({ primary, secondary }));
      if (
        prior?.sourceHash === sourceHash &&
        prior?.paletteHash === paletteHash
      ) {
        staged.push({ ...prior, ...identity, checkedAt });
        continue;
      }
      const out = await env.IMAGES.input(
        new Response(original as BodyInit).body!,
      )
        .transform({
          width: 512,
          height: 512,
          fit: "contain",
          background: "transparent",
        })
        .output({ format: "image/png" });
      const png = new Uint8Array(await out.response().arrayBuffer());
      const d = decode(png);
      if (
        d.width !== 512 ||
        d.height !== 512 ||
        d.channels !== 4 ||
        !Array.from(d.data).some((v, i) => i % 4 === 3 && v < 255)
      )
        throw Error("Logo normalization/transparency invalid");
      logoHash = await hash(png);
      version = await hash(logoHash + paletteHash);
      logoKey = `branding/${identity.id}/${version}.png`;
      const originalKey = `originals/${identity.id}/${sourceHash}`;
      await env.MEDIA.put(originalKey, original);
      await env.MEDIA.put(logoKey, png, {
        httpMetadata: { contentType: "image/png" },
      });
      const readback = await env.MEDIA.get(logoKey);
      if (!readback || (await hash(await readback.arrayBuffer())) !== logoHash)
        throw Error("R2 readback mismatch");
      staged.push({
        ...identity,
        primary,
        secondary,
        paletteSource: t.paletteSource,
        sourceUrl,
        sourceHash,
        checkedAt,
        retrievedAt: checkedAt,
        mime: "image/png",
        width: 512,
        height: 512,
        transparent: true,
        attribution:
          "Team/league trademarks; ESPN-distributed branding. Rights review required for commercial use.",
        version,
        logoKey,
        logoHash,
        paletteHash,
        originalKey,
      });
    } catch (e) {
      gaps.push({
        team: seed.id,
        error: e instanceof Error ? e.message : "Validation failed",
      });
    }
  }
  const report = {
    league: id,
    checkedAt,
    teams: teams.length,
    selectableTeams: teams.filter((t) => !t.catalogOpponent).length,
    supportingOpponents: teams.filter((t) => t.catalogOpponent).length,
    logos: staged.length,
    palettes: staged.length,
    gaps,
    ready: !gaps.length,
  };
  if (gaps.length) {
    await sql(
      env,
      "UPDATE leagues SET enabled=0,report=?,checked_at=? WHERE id=?",
      JSON.stringify(report),
      checkedAt,
      id,
    ).run();
  } else {
    const statements = [];
    for (const m of staged)
      statements.push(
        sql(
          env,
          "INSERT OR IGNORE INTO team_versions VALUES(?,?,?,?,?,?)",
          m.id,
          m.version,
          m.logoKey,
          m.logoHash,
          m.paletteHash,
          JSON.stringify(m),
        ),
        sql(
          env,
          "INSERT INTO teams VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,active_version=excluded.active_version",
          m.id,
          JSON.stringify(m),
          m.version,
        ),
      );
    statements.push(sql(env, "DELETE FROM memberships WHERE league=?", id));
    for (const m of staged.filter((m) => !m.catalogOpponent))
      statements.push(
        sql(env, "INSERT INTO memberships VALUES(?,?)", id, m.id),
      );
    statements.push(
      sql(
        env,
        "UPDATE leagues SET report=?,checked_at=? WHERE id=?",
        JSON.stringify(report),
        checkedAt,
        id,
      ),
    );
    await env.DB.batch(statements);
  }
  await sql(
    env,
    "INSERT INTO audit(kind,object_id,detail,created_at) VALUES(?,?,?,?)",
    "catalog-maintenance",
    id,
    JSON.stringify(report),
    now(),
  ).run();
}
function hex(v: unknown) {
  return typeof v === "string" && /^[\da-f]{6}$/i.test(v)
    ? "#" + v.toUpperCase()
    : null;
}
