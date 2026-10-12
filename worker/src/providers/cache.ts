import { type Env, sql, now } from "../env";
import { espn } from "./espn";
export async function cachedGame(env: Env, id: string, fresh = false) {
  const key = "game:" + id;
  const row = await sql(
    env,
    "SELECT value FROM cache WHERE key=? AND expires>?",
    key,
    now(),
  ).first<{ value: string }>();
  if (row && !fresh) return JSON.parse(row.value);
  const g = await espn.getGame(id);
  await sql(
    env,
    "INSERT OR REPLACE INTO cache VALUES(?,?,?)",
    key,
    JSON.stringify(g),
    now() + (g.status === "live" ? 10 : g.status === "final" ? 900 : 300),
  ).run();
  return g;
}
export async function sharedGame(env: Env, id: string, fresh = false) {
  const r = await env.COORDINATOR.get(
    env.COORDINATOR.idFromName("facts:" + id),
  ).fetch("https://internal/facts", {
    method: "POST",
    body: JSON.stringify({ id, fresh }),
  });
  if (!r.ok) throw Error("Sports provider unavailable");
  return r.json() as Promise<any>;
}
