import { type Env, sql, now } from "./env";
export async function isAdmin(env: Env, owner: string) {
  if (!env.ADMIN_GOOGLE_SUB) return false;
  const p = await sql(
    env,
    "SELECT google_sub FROM principals WHERE id=?",
    owner,
  ).first<{ google_sub: string }>();
  return !!p?.google_sub && p.google_sub === env.ADMIN_GOOGLE_SUB;
}
export async function stats(
  env: Env,
  days: number,
): Promise<Record<string, any>> {
  const since = days ? now() - days * 86400 : 0;
  const firstDay = new Date(since * 1000).toISOString().slice(0, 10);
  const queries = {
    users: `SELECT COUNT(*) AS accounts FROM principals WHERE google_sub IS NOT NULL AND created_at>=?`,
    images: `SELECT COUNT(*) AS attempts, SUM(status='complete') AS completed, SUM(status='failed') AS failed, SUM(status NOT IN ('complete','failed')) AS active, SUM(status='complete' AND deleted_at IS NULL) AS retained FROM jobs WHERE created_at>=?`,
    purchases: `SELECT COUNT(*) AS packs,COALESCE(SUM(amount),0) AS grossCents,COALESCE(SUM(credits),0) AS credits FROM purchases WHERE status='paid' AND created_at>=?`,
    review: `SELECT COUNT(*) AS purchases FROM purchases WHERE status='review' AND created_at>=?`,
    shares: `SELECT COUNT(*) AS published FROM shares WHERE published=1 AND created_at>=?`,
    usage: `SELECT pool,COUNT(*) AS used FROM ledger WHERE kind='captured' AND created_at>=? GROUP BY pool`,
    daily: `SELECT date(created_at,'unixepoch') AS day, COUNT(*) AS images FROM jobs WHERE status='complete' AND created_at>=? GROUP BY day ORDER BY day DESC LIMIT 30`,
  };
  const result: Record<string, any> = {};
  await Promise.all(
    Object.entries(queries).map(async ([key, q]) => {
      const rows = await sql(env, q, since).all();
      result[key] = ["usage", "daily"].includes(key)
        ? rows.results
        : rows.results[0];
    }),
  );
  result.traffic = await sql(
    env,
    `SELECT COALESCE(SUM(views),0) AS views,(SELECT COUNT(DISTINCT visitor) FROM traffic_visitors WHERE day>=?) AS visitors,MIN(day) AS trackingSince FROM traffic_daily WHERE day>=?`,
    firstDay,
    firstDay,
  ).first();
  result.trafficDaily = (
    await sql(
      env,
      "SELECT day,views FROM traffic_daily WHERE day>=? ORDER BY day DESC LIMIT 30",
      firstDay,
    ).all()
  ).results;
  return { ...result, days, generatedAt: now() };
}
