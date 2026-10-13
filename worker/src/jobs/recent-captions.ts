import { type Env, sql } from "../env";

/** Global recent premises, with no owner, input, photo, or identity data. */
export async function recentCaptions(env: Env, currentId: string) {
  const rows = await sql(
    env,
    "SELECT caption FROM jobs WHERE id!=? AND caption IS NOT NULL AND deleted_at IS NULL AND status!='failed' ORDER BY created_at DESC,id DESC LIMIT 15",
    currentId,
  ).all<{ caption: string }>();
  return rows.results.flatMap(({ caption }) => {
    try {
      const value = JSON.parse(caption);
      if (typeof value.text !== "string" || typeof value.visual !== "string")
        return [];
      return [
        {
          text: value.text.slice(0, 180),
          visual: value.visual.slice(0, 1000),
          ...(typeof value.theme === "string"
            ? { theme: value.theme.slice(0, 160) }
            : {}),
        },
      ];
    } catch {
      return [];
    }
  });
}
