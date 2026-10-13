import { type Env, sql, hash } from "../env";
import { dataUrl } from "./media";

export async function loadLogo(env: Env, team: any) {
  const object = await env.MEDIA.get(team.logoKey);
  if (!object) throw Error("Logo missing");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await hash(bytes)) !== team.logoHash) throw Error("Logo hash mismatch");
  return dataUrl(bytes, "image/png");
}

export async function loadPinnedTeams(env: Env, pins: any) {
  const entries = await Promise.all(
    ["away", "home"].map(async (side) => {
      const row = await sql(
        env,
        "SELECT metadata FROM team_versions WHERE team_id=? AND version=?",
        pins[side].id,
        pins[side].version,
      ).first<{ metadata: string }>();
      if (!row) throw Error("Pinned team catalog missing");
      const team = JSON.parse(row.metadata);
      const logo = await loadLogo(env, team);
      return [
        side,
        { team: { ...team, color: team.primary, logo: team.logoKey }, logo },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
