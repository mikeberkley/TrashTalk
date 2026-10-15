import { type Env, sql } from "../env";
import {
  backgroundCharacters,
  selectBackgroundCharacter,
} from "../../../packages/trash-talk/src/background-character";

export async function chooseBackgroundCharacter(
  env: Env,
  id: string,
  retryOf?: string,
) {
  if (retryOf) {
    const prior = await sql(
      env,
      "SELECT context FROM jobs WHERE id=?",
      retryOf,
    ).first<{ context: string | null }>();
    try {
      const name = JSON.parse(prior?.context || "null")?.backgroundCharacter;
      if (backgroundCharacters.includes(name)) return name as string;
    } catch {
      /* Legacy malformed context has no reusable selection. */
    }
  }
  // One latest occurrence per character covers the entire pool, not a short caption window.
  // Include failed/deleted jobs so an assigned character still counts as used.
  const rows = await sql(
    env,
    `SELECT json_extract(context,'$.backgroundCharacter') AS name, MAX(created_at) AS last_used
    FROM jobs WHERE id!=? AND json_valid(context)
    AND json_extract(context,'$.backgroundCharacter') IS NOT NULL
    GROUP BY name ORDER BY last_used DESC,name`,
    id,
  ).all<{ name: string }>();
  return selectBackgroundCharacter(
    rows.results.map((r) => r.name),
    id,
  );
}
