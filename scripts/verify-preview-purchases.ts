import fs from "node:fs/promises";
import { cf } from "./cloudflare";
const database = "85dff09d-619c-426f-99be-3203ed94abf6";
async function query(sql: string) {
  const response: any = await (
    await cf(`/d1/database/${database}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    })
  ).json();
  if (!response.success || !response.result?.[0]?.success)
    throw Error("Preview database query failed");
  return response.result[0].results;
}
const purchases = await query(
  `SELECT substr(p.session_id,-12) AS checkout_suffix,p.session_id LIKE 'cs_test_%' AS stripe_test_session,p.status,p.amount AS amount_cents,p.credits,p.payment_id IS NOT NULL AS has_payment_intent,datetime(p.created_at,'unixepoch') AS created_at_utc,EXISTS(SELECT 1 FROM principals a WHERE a.id=p.owner AND a.google_sub IS NOT NULL) AS google_account_linked,(SELECT COUNT(*) FROM ledger l WHERE l.business_key='purchase:'||p.session_id AND l.kind='grant' AND l.pool='paid') AS grant_count,(SELECT COALESCE(SUM(l.amount),0) FROM ledger l WHERE l.business_key='purchase:'||p.session_id AND l.kind='grant' AND l.pool='paid') AS credits_granted,(SELECT COALESCE(SUM(l.amount),0) FROM ledger l WHERE l.owner=p.owner AND l.pool='paid') AS current_paid_balance FROM purchases p ORDER BY p.created_at DESC LIMIT 10`,
);
const events = await query(
  `SELECT substr(id,-12) AS event_suffix,type,datetime(created_at,'unixepoch') AS processed_at_utc FROM webhook_events ORDER BY created_at DESC LIMIT 20`,
);
const report = {
  checkedAt: new Date().toISOString(),
  environment: "preview",
  source: "Cloudflare D1 remote read-only queries",
  purchases,
  processedWebhookEvents: events,
  latestPaidPurchaseVerified:
    purchases[0]?.stripe_test_session === 1 &&
    purchases[0]?.status === "paid" &&
    purchases[0]?.amount_cents === 99 &&
    purchases[0]?.credits_granted === 4 &&
    purchases[0]?.grant_count === 1,
  limitations:
    "Stripe Dashboard sandbox delivery and manual replay inspected separately during launch checks. Webhook event records contain event ID/type/time, not a Checkout session foreign key.",
};
await fs.writeFile(
  "reports/stripe-purchase-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
