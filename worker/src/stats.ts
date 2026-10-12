import { type Env, sql, now, hash } from "./env";
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

export async function excludeTraffic(env: Env, ip?: string, token?: string) {
  if (
    ip &&
    (env.STATS_EXCLUDED_IPS || "")
      .split(",")
      .map((x) => x.trim())
      .includes(ip)
  )
    return true;
  if (!token || !env.ADMIN_GOOGLE_SUB) return false;
  const session = await sql(
    env,
    "SELECT principal FROM sessions WHERE token_hash=? AND expires>?",
    await hash(token),
    now(),
  ).first<{ principal: string }>();
  return session ? isAdmin(env, session.principal) : false;
}

export async function statDetails(
  env: Env,
  metric: string,
  days: number,
  offset: number,
) {
  const since = days ? now() - days * 86400 : 0;
  const firstDay = new Date(since * 1000).toISOString().slice(0, 10);
  const imageFilters: Record<string, string> = {
    completed: "status='complete'",
    retained: "status='complete' AND deleted_at IS NULL",
    attempts: "1=1",
    failed: "status='failed'",
    active: "status NOT IN ('complete','failed')",
  };
  let query: string,
    values: any[],
    columns: string[],
    note = "";
  if (metric === "views") {
    query =
      'SELECT day AS "Date (UTC)",views AS "Page views" FROM traffic_daily WHERE day>=? ORDER BY day DESC';
    values = [firstDay];
    columns = ["Date (UTC)", "Page views"];
    note =
      "Page views are stored as daily totals. Individual page visits and IP addresses are not stored. Home-IP and signed-in operator traffic are excluded.";
  } else if (metric === "visitors") {
    query =
      'SELECT visitor AS "Browser identifier",MIN(day) AS "First seen (UTC)",MAX(day) AS "Last seen (UTC)",COUNT(*) AS "Days visited" FROM traffic_visitors WHERE day>=? GROUP BY visitor ORDER BY MAX(day) DESC,visitor';
    values = [firstDay];
    columns = [
      "Browser identifier",
      "First seen (UTC)",
      "Last seen (UTC)",
      "Days visited",
    ];
    note =
      "These are hashed browser identifiers, not people. Records cover at most 90 days. Home-IP and signed-in operator traffic are excluded.";
  } else if (metric === "accounts") {
    query = `SELECT id AS "Account",google_sub AS "Google identifier",datetime(created_at,'unixepoch') AS "Created (UTC)" FROM principals WHERE google_sub IS NOT NULL AND created_at>=? ORDER BY created_at DESC,id`;
    values = [since];
    columns = ["Account", "Google identifier", "Created (UTC)"];
    note =
      "The app stores Google identifiers, not names or email addresses. Account creation may precede Google sign-in.";
  } else if (Object.hasOwn(imageFilters, metric)) {
    query = `SELECT id AS "Image",owner AS "Account",status AS "Status",datetime(created_at,'unixepoch') AS "Created (UTC)",CASE WHEN deleted_at IS NULL THEN 'No' ELSE 'Yes' END AS "Deleted",error AS "Error" FROM jobs WHERE created_at>=? AND (${imageFilters[metric]}) ORDER BY created_at DESC,id`;
    values = [since];
    columns = [
      "Image",
      "Account",
      "Status",
      "Created (UTC)",
      "Deleted",
      "Error",
    ];
  } else if (["packs", "credits", "amount", "review"].includes(metric)) {
    query = `SELECT session_id AS "Checkout",owner AS "Account",status AS "Status",printf('$%.2f',amount/100.0) AS "Amount",credits AS "Credits",datetime(created_at,'unixepoch') AS "Created (UTC)" FROM purchases WHERE status=? AND created_at>=? ORDER BY created_at DESC,session_id`;
    values = [metric === "review" ? "review" : "paid", since];
    columns = [
      "Checkout",
      "Account",
      "Status",
      "Amount",
      "Credits",
      "Created (UTC)",
    ];
    note =
      "Each row is a purchase. Credits and amount boxes total the corresponding columns. Review purchases are excluded from paid totals; amounts are not net revenue.";
  } else if (["trial", "paid"].includes(metric)) {
    query = `SELECT l.job_id AS "Image",l.owner AS "Account",l.pool AS "Credit pool",datetime(l.created_at,'unixepoch') AS "Used (UTC)" FROM ledger l WHERE l.kind='captured' AND l.pool=? AND l.created_at>=? ORDER BY l.created_at DESC,l.id DESC`;
    values = [metric, since];
    columns = ["Image", "Account", "Credit pool", "Used (UTC)"];
    note = "Each row is one credit captured for a successful image.";
  } else if (metric === "shares") {
    query = `SELECT s.job_id AS "Image",j.owner AS "Account",datetime(s.created_at,'unixepoch') AS "Created (UTC)",CASE WHEN j.deleted_at IS NULL THEN 'No' ELSE 'Yes' END AS "Image deleted" FROM shares s JOIN jobs j ON j.id=s.job_id WHERE s.published=1 AND s.created_at>=? ORDER BY s.created_at DESC,s.token`;
    values = [since];
    columns = ["Image", "Account", "Created (UTC)", "Image deleted"];
    note =
      "Published share records use their creation date and include subsequently deleted images.";
  } else return null;
  const rows = (
    await sql(env, query + " LIMIT 51 OFFSET ?", ...values, offset).all()
  ).results;
  const more = rows.length > 50;
  return {
    columns,
    rows: rows.slice(0, 50),
    note,
    nextOffset: more ? offset + 50 : null,
  };
}
