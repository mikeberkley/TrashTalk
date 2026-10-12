import fs from "node:fs/promises";
import { cf } from "./cloudflare";
const origin = "https://trashtalk.fanlift.ai";
async function query(sql: string) {
  const d: any = await (
    await cf("/d1/database/bd437dbf-a29f-4ffe-89f6-f6a8b16a53b2/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    })
  ).json();
  if (!d.success || !d.result?.[0]?.success)
    throw Error("D1 verification failed");
  return d.result[0].results;
}
const jobs = await query(
  "SELECT j.id,j.status,j.caption,j.context,r.state AS credit_state,EXISTS(SELECT 1 FROM principals p WHERE p.id=j.owner AND p.google_sub IS NOT NULL) AS google_linked,(SELECT SUM(amount) FROM ledger WHERE owner=j.owner AND pool='trial') AS free_balance FROM jobs j LEFT JOIN reservations r ON r.job_id=j.id ORDER BY j.created_at LIMIT 1",
);
const jobsSummary = jobs.map((j: any) => {
  const c = JSON.parse(j.context || "{}");
  return {
    id: j.id,
    status: j.status,
    caption: JSON.parse(j.caption || "null"),
    creditState: j.credit_state,
    googleLinked: j.google_linked === 1,
    freeBalance: j.free_balance,
    promptVersion: c.promptVersion,
    research: {
      searchRequests: c.research?.searchRequests,
      sources: c.research?.sources,
      limitation: c.research?.limitation,
    },
    logoVersions: { home: c.home?.version, away: c.away?.version },
  };
});
const purchases = await query(
  "SELECT session_id LIKE 'cs_live_%' AS live_session,status,amount,credits,(SELECT COUNT(*) FROM ledger WHERE business_key='purchase:'||p.session_id) AS grants FROM purchases p ORDER BY created_at DESC LIMIT 5",
);
const leagues = await query(
  "SELECT l.id,l.enabled,COUNT(m.team_id) AS teams FROM leagues l LEFT JOIN memberships m ON m.league=l.id GROUP BY l.id ORDER BY l.id",
);
const shares = await query(
  "SELECT token FROM shares WHERE job_id='693f3924-56c3-472b-96a6-dca8aeec83e2'",
);
const paths = [
  "/",
  "/privacy",
  "/terms",
  "/api/leagues",
  "/api/generations/693f3924-56c3-472b-96a6-dca8aeec83e2/image",
  ...(shares[0] ? ["/m/" + shares[0].token] : []),
];
const http = await Promise.all(
  paths.map(async (path) => {
    const r = await fetch(origin + path);
    return { path, status: r.status };
  }),
);
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  jobs: jobsSummary,
  purchases,
  leagues,
  http,
  limitations: [
    "No real payment submitted; live webhook fulfillment not verified.",
    "Native sharing confirmed by user on physical iPhone in preview; production Chrome automation reported Permission denied from native sharing.",
    "No live game currently available; production generation tested pregame.",
  ],
};
await fs.writeFile(
  "reports/production-launch.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
