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
// Include anonymous principals merged into the operator account so historical
// credit captures remain excluded even when their ledger owner was not moved.
function externalOwner(owner: string) {
  return `${owner} NOT IN (WITH RECURSIVE operator(id) AS (
    SELECT id FROM principals WHERE google_sub=?
    UNION SELECT p.id FROM principals p JOIN operator o ON p.merged_into=o.id
  ) SELECT id FROM operator)`;
}
function recentTraffic(since: number) {
  return `WITH recent AS (SELECT * FROM traffic_events WHERE created_at>=${since}),
    traffic_daily AS (SELECT date(created_at,'unixepoch') AS day, COUNT(*) AS views FROM recent GROUP BY day),
    traffic_ip_daily AS (SELECT date(created_at,'unixepoch') AS day,ip,COUNT(*) AS views,MIN(created_at) AS first_seen,MAX(created_at) AS last_seen FROM recent GROUP BY day,ip),
    traffic_visitors AS (SELECT date(created_at,'unixepoch') AS day,visitor,MIN(created_at) AS first_seen,MAX(created_at) AS last_seen FROM recent GROUP BY day,visitor),
    traffic_visitor_ips AS (SELECT DISTINCT date(created_at,'unixepoch') AS day,visitor,ip FROM recent) `;
}
export async function stats(
  env: Env,
  days: number,
): Promise<Record<string, any>> {
  const since = days ? now() - days * 86400 : 0;
  const firstDay = new Date(since * 1000).toISOString().slice(0, 10);
  const trafficPrefix = days > 0 && days <= 1 ? recentTraffic(since) : "";
  const queries = {
    users: `SELECT COUNT(*) AS accounts FROM principals WHERE google_sub IS NOT NULL AND created_at>=?`,
    images: `SELECT COUNT(*) AS attempts, SUM(status='complete') AS completed, SUM(status='failed') AS failed, SUM(status NOT IN ('complete','failed')) AS active, SUM(status='complete' AND deleted_at IS NULL) AS retained FROM jobs WHERE ${externalOwner("jobs.owner")} AND created_at>=?`,
    purchases: `SELECT COUNT(*) AS packs,COALESCE(SUM(amount),0) AS grossCents,COALESCE(SUM(credits),0) AS credits FROM purchases WHERE ${externalOwner("purchases.owner")} AND status='paid' AND created_at>=?`,
    review: `SELECT COUNT(*) AS purchases FROM purchases WHERE ${externalOwner("purchases.owner")} AND status='review' AND created_at>=?`,
    shares: `SELECT COUNT(*) AS published FROM shares JOIN jobs ON jobs.id=shares.job_id WHERE ${externalOwner("jobs.owner")} AND published=1 AND shares.created_at>=?`,
    usage: `SELECT pool,COUNT(*) AS used FROM ledger WHERE ${externalOwner("ledger.owner")} AND kind='captured' AND created_at>=? GROUP BY pool`,
    daily: `SELECT date(created_at,'unixepoch') AS day, COUNT(*) AS images FROM jobs WHERE ${externalOwner("jobs.owner")} AND status='complete' AND created_at>=? GROUP BY day ORDER BY day DESC LIMIT 30`,
  };
  const result: Record<string, any> = {};
  await Promise.all(
    Object.entries(queries).map(async ([key, q]) => {
      const rows = await sql(
        env,
        q,
        ...(key === "users" ? [] : [env.ADMIN_GOOGLE_SUB || ""]),
        since,
      ).all();
      result[key] = ["usage", "daily"].includes(key)
        ? rows.results
        : rows.results[0];
    }),
  );
  result.traffic = await sql(
    env,
    trafficPrefix +
      `SELECT COALESCE(SUM(views),0) AS views,(SELECT COUNT(DISTINCT visitor) FROM traffic_visitors WHERE day>=?) AS visitors,MIN(day) AS trackingSince FROM traffic_daily WHERE day>=?`,
    firstDay,
    firstDay,
  ).first();
  result.trafficDaily = (
    await sql(
      env,
      trafficPrefix +
        "SELECT day,views FROM traffic_daily WHERE day>=? ORDER BY day DESC LIMIT 30",
      firstDay,
    ).all()
  ).results;
  result.trafficNote =
    days > 0 && days <= 1
      ? "Hourly traffic tracking begins with this update; earlier page views cannot be assigned to these rolling windows."
      : "";
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
  const trafficPrefix = days > 0 && days <= 1 ? recentTraffic(since) : "";
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
    query = `SELECT i.day AS "Date (UTC)",CASE WHEN i.ip='' THEN 'Not recorded' ELSE i.ip END AS "IP address",g.city AS "City",g.state AS "State / region",g.country AS "Country",i.views AS "Page views",i.first_seen AS "First visit (ET)",i.last_seen AS "Last visit (ET)" FROM traffic_ip_daily i LEFT JOIN traffic_ip_locations g ON g.ip=i.ip WHERE i.day>=?
      UNION ALL SELECT d.day AS "Date (UTC)",'Not recorded' AS "IP address",NULL AS "City",NULL AS "State / region",NULL AS "Country",d.views-COALESCE((SELECT SUM(i.views) FROM traffic_ip_daily i WHERE i.day=d.day),0) AS "Page views",NULL AS "First visit (ET)",NULL AS "Last visit (ET)" FROM traffic_daily d WHERE d.day>=? AND d.views>COALESCE((SELECT SUM(i.views) FROM traffic_ip_daily i WHERE i.day=d.day),0) ORDER BY "Date (UTC)" DESC,"Last visit (ET)" DESC,"IP address"`;
    values = [firstDay, firstDay];
    columns = [
      "Date (UTC)",
      "IP address",
      "City",
      "State / region",
      "Country",
      "Page views",
      "First visit (ET)",
      "Last visit (ET)",
    ];
    note =
      "Page views are grouped by day and IP address. Daily IP records are retained for 90 days; the first location for each IP is cached. Geolocation is approximate; country uses its two-letter code. Older views or visits before IP tracking show “Not recorded.” Home-IP and signed-in operator traffic are excluded. Traffic timestamps begin with this update; earlier times were not recorded.";
  } else if (metric === "visitors") {
    query = `SELECT COALESCE(GROUP_CONCAT(DISTINCT NULLIF(i.ip,'')),'Not recorded') AS "IP addresses",GROUP_CONCAT(DISTINCT CASE WHEN i.ip IS NOT NULL AND i.ip!='' THEN i.ip||': '||COALESCE(g.city,'Unknown city')||', '||COALESCE(g.state,'Unknown region')||', '||COALESCE(g.country,'Unknown country') END) AS "Locations",MIN(v.first_seen) AS "First seen (ET)",MAX(v.last_seen) AS "Last seen (ET)",COUNT(DISTINCT v.day) AS "Days visited" FROM traffic_visitors v LEFT JOIN traffic_visitor_ips i ON i.day=v.day AND i.visitor=v.visitor LEFT JOIN traffic_ip_locations g ON g.ip=i.ip WHERE v.day>=? GROUP BY v.visitor ORDER BY MAX(v.day) DESC,MAX(v.last_seen) DESC,v.visitor`;
    values = [firstDay];
    columns = [
      "IP addresses",
      "Locations",
      "First seen (ET)",
      "Last seen (ET)",
      "Days visited",
    ];
    note =
      "Browser records and their recorded IP addresses cover at most 90 days. A browser can use several IPs, and an IP can be shared by several people. Home-IP and signed-in operator traffic are excluded. Traffic timestamps begin with this update; earlier times were not recorded.";
  } else if (metric === "accounts") {
    query = `SELECT datetime(created_at,'unixepoch') AS "Created (UTC)" FROM principals WHERE google_sub IS NOT NULL AND created_at>=? ORDER BY created_at DESC,id`;
    values = [since];
    columns = ["Created (UTC)"];
    note =
      "The app stores Google identifiers, not names or email addresses. Account creation may precede Google sign-in.";
  } else if (Object.hasOwn(imageFilters, metric)) {
    query = `SELECT json_extract(caption,'$.text') AS "Caption",status AS "Status",datetime(created_at,'unixepoch') AS "Created (UTC)",CASE WHEN deleted_at IS NULL THEN 'No' ELSE 'Yes' END AS "Deleted",error AS "Error",id AS "Job ID",call_started AS "Stage",(SELECT detail FROM audit WHERE kind='provider_error' AND object_id=jobs.id ORDER BY id DESC LIMIT 1) AS "Provider details" FROM jobs WHERE ${externalOwner("jobs.owner")} AND created_at>=? AND (${imageFilters[metric]}) ORDER BY created_at DESC,id`;
    values = [since];
    columns = [
      "Caption",
      "Status",
      "Created (UTC)",
      "Deleted",
      "Error",
      "Job ID",
      "Stage",
      "Provider details",
    ];
    note =
      "Provider details include sanitized response messages, model, HTTP status, timing, and request IDs. Details are recorded from this update onward; older failures may have no provider details.";
  } else if (["packs", "credits", "amount", "review"].includes(metric)) {
    query = `SELECT status AS "Status",printf('$%.2f',amount/100.0) AS "Amount",credits AS "Credits",datetime(created_at,'unixepoch') AS "Created (UTC)" FROM purchases WHERE ${externalOwner("purchases.owner")} AND status=? AND created_at>=? ORDER BY created_at DESC,session_id`;
    values = [metric === "review" ? "review" : "paid", since];
    columns = ["Status", "Amount", "Credits", "Created (UTC)"];
    note =
      "Each row is a purchase. Credits and amount boxes total the corresponding columns. Review purchases are excluded from paid totals; amounts are not net revenue.";
  } else if (["trial", "paid"].includes(metric)) {
    query = `SELECT json_extract(j.caption,'$.text') AS "Caption",l.pool AS "Credit pool",datetime(l.created_at,'unixepoch') AS "Used (UTC)" FROM ledger l LEFT JOIN jobs j ON j.id=l.job_id WHERE ${externalOwner("l.owner")} AND l.kind='captured' AND l.pool=? AND l.created_at>=? ORDER BY l.created_at DESC,l.id DESC`;
    values = [metric, since];
    columns = ["Caption", "Credit pool", "Used (UTC)"];
    note = "Each row is one credit captured for a successful image.";
  } else if (metric === "shares") {
    query = `SELECT json_extract(j.caption,'$.text') AS "Caption",datetime(s.created_at,'unixepoch') AS "Created (UTC)",CASE WHEN j.deleted_at IS NULL THEN 'No' ELSE 'Yes' END AS "Image deleted" FROM shares s JOIN jobs j ON j.id=s.job_id WHERE ${externalOwner("j.owner")} AND s.published=1 AND s.created_at>=? ORDER BY s.created_at DESC,s.token`;
    values = [since];
    columns = ["Caption", "Created (UTC)", "Image deleted"];
    note =
      "Published share records use their creation date and include subsequently deleted images.";
  } else return null;
  if (metric === "views" || metric === "visitors") {
    query = trafficPrefix + query;
    if (trafficPrefix)
      note +=
        " Hourly traffic tracking begins with this update; earlier visits are not included.";
  } else if (metric !== "accounts")
    note += " Operator account activity is excluded.";
  const rows = (
    await sql(
      env,
      query + " LIMIT 51 OFFSET ?",
      ...(["views", "visitors", "accounts"].includes(metric)
        ? []
        : [env.ADMIN_GOOGLE_SUB || ""]),
      ...values,
      offset,
    ).all()
  ).results;
  const more = rows.length > 50;
  const timeColumns = [
    "Last visit (ET)",
    "Last seen (ET)",
    "Created (UTC)",
    "Used (UTC)",
    "First visit (ET)",
    "First seen (ET)",
    "Date (UTC)",
  ];
  columns = [
    ...timeColumns.filter((col) => columns.includes(col)),
    ...columns.filter((col) => !timeColumns.includes(col)),
  ];
  return {
    columns: columns.map((col) =>
      col === "Date (UTC)" ? "Day (UTC)" : col.replace("(UTC)", "(ET)"),
    ),
    rows: rows.slice(0, 50).map((row: any) =>
      Object.fromEntries(
        Object.entries(row).map(([col, value]) => {
          // Daily aggregates have only a date; keep that grouping explicit in UTC.
          if (col === "Date (UTC)") return ["Day (UTC)", value];
          if (col.endsWith("(UTC)"))
            return [
              col.replace("(UTC)", "(ET)"),
              formatEastern(String(value).replace(" ", "T") + "Z"),
            ];
          if (col.endsWith("(ET)"))
            return [
              col,
              value == null
                ? "Time not recorded"
                : formatEastern(Number(value) * 1000),
            ];
          return [col, value];
        }),
      ),
    ),
    note,
    nextOffset: more ? offset + 50 : null,
  };
}

export async function pruneTraffic(env: Env) {
  await sql(
    env,
    "DELETE FROM traffic_events WHERE created_at < unixepoch()-90*86400",
  ).run();
  await env.DB.batch(
    ["traffic_visitors", "traffic_ip_daily", "traffic_visitor_ips"].map(
      (table) =>
        sql(env, `DELETE FROM ${table} WHERE day < date('now','-90 days')`),
    ),
  );
}

// Cloudflare already resolves request geolocation. Read it only for uncached IPs;
// INSERT OR IGNORE makes the first saved value authoritative under concurrent visits.
export async function cacheIpLocation(
  env: Env,
  ip: string,
  lookup: () =>
    { city?: string; region?: string; country?: string } | undefined,
) {
  if (
    !ip ||
    (await sql(
      env,
      "SELECT ip FROM traffic_ip_locations WHERE ip=?",
      ip,
    ).first())
  )
    return;
  const geo = lookup();
  await sql(
    env,
    "INSERT OR IGNORE INTO traffic_ip_locations(ip,city,state,country,created_at) VALUES(?,?,?,?,?)",
    ip,
    geo?.city || null,
    geo?.region || null,
    geo?.country || null,
    now(),
  ).run();
}

export function formatEastern(value: string | number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
