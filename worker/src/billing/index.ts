import Stripe from "stripe";
import { offer } from "../../../packages/contracts/src/generation";
import { type Env, sql, now } from "../env";
export function stripe(env: Env) {
  if (!env.STRIPE_SECRET_KEY) throw Error("Payments are not configured yet");
  if (
    env.ENVIRONMENT !== "production" &&
    !env.STRIPE_SECRET_KEY.startsWith("sk_test_")
  )
    throw Error("Preview requires Stripe test mode");
  if (
    env.ENVIRONMENT === "production" &&
    !env.STRIPE_SECRET_KEY.startsWith("sk_live_")
  )
    throw Error("Production requires Stripe live mode");
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}
export async function checkout(
  env: Env,
  owner: string,
  key: string,
  api = stripe(env),
) {
  if (!key || key.length > 100)
    throw Error("Purchase idempotency key required");
  const account = await sql(
    env,
    "SELECT google_sub FROM principals WHERE id=?",
    owner,
  ).first<any>();
  if (!account?.google_sub) throw Error("Sign in with Google first");
  const s = await api.checkout.sessions.create(
    {
      mode: "payment",
      allowed_payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: offer.currency,
            unit_amount: offer.priceCents,
            product_data: {
              name: `TrashTalk — ${offer.credits} image credits`,
            },
          },
          quantity: 1,
        },
      ],
      client_reference_id: owner,
      metadata: { owner, pack: offer.pack },
      success_url:
        env.ORIGIN + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: env.ORIGIN + "/?checkout=canceled",
    },
    { idempotencyKey: `${owner}:${key}` },
  );
  await sql(
    env,
    "INSERT OR IGNORE INTO purchases VALUES(?,?,NULL,'pending',?,?,?)",
    s.id,
    owner,
    offer.priceCents,
    offer.credits,
    now(),
  ).run();
  return s.url;
}
export async function webhook(
  env: Env,
  body: string,
  signature: string,
  api = stripe(env),
) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw Error("Webhook not configured");
  const event = await api.webhooks.constructEventAsync(
    body,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
    300,
    Stripe.createSubtleCryptoProvider(),
  );
  if (
    await sql(env, "SELECT id FROM webhook_events WHERE id=?", event.id).first()
  )
    return;
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const received = event.data.object as Stripe.Checkout.Session;
    const session = await api.checkout.sessions.retrieve(received.id, {
      expand: ["line_items"],
    });
    const owner = session.client_reference_id;
    // Preserve the price and credit count of earlier issued packs.
    const pack =
      session.metadata?.pack === offer.pack
        ? offer
        : session.metadata?.pack === "four-v1"
          ? { priceCents: 99, credits: 4 }
          : session.metadata?.pack === "five-v2"
            ? { priceCents: 99, credits: 5 }
            : session.metadata?.pack === "five-v1"
              ? { priceCents: 100, credits: 5 }
              : null;
    if (session.payment_status !== "paid") return;
    if (
      !owner ||
      session.mode !== "payment" ||
      session.amount_total !== pack?.priceCents ||
      session.currency !== "usd" ||
      pack === null ||
      session.metadata?.owner !== owner ||
      session.line_items?.data.length !== 1 ||
      session.line_items.data[0].quantity !== 1
    )
      throw Error("Unexpected payment pack");
    if (
      !(await sql(
        env,
        "SELECT id FROM principals WHERE id=? AND google_sub IS NOT NULL",
        owner,
      ).first())
    )
      throw Error("Unknown payment owner");
    await env.DB.batch([
      sql(
        env,
        "INSERT INTO purchases VALUES(?,?,?,'paid',?,?,?) ON CONFLICT(session_id) DO UPDATE SET status=CASE WHEN purchases.status='review' THEN 'review' ELSE 'paid' END,payment_id=excluded.payment_id",
        session.id,
        owner,
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null,
        pack.priceCents,
        pack.credits,
        now(),
      ),
      sql(
        env,
        "INSERT OR IGNORE INTO ledger(owner,kind,amount,pool,business_key,payment_id,created_at) SELECT ?,'grant',?,'paid',?,?,? WHERE NOT EXISTS(SELECT 1 FROM ledger WHERE business_key=?) AND EXISTS(SELECT 1 FROM purchases WHERE session_id=? AND status='paid')",
        owner,
        pack.credits,
        "purchase:" + session.id,
        session.id,
        now(),
        "reversal:" + session.id,
        session.id,
      ),
      sql(
        env,
        "INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)",
        event.id,
        event.type,
        now(),
      ),
    ]);
  } else if (
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created"
  ) {
    const obj: any = event.data.object;
    let pi = obj.payment_intent;
    if (!pi && obj.charge) {
      const c = await api.charges.retrieve(obj.charge);
      pi = c.payment_intent;
    }
    const p = await sql(
      env,
      "SELECT * FROM purchases WHERE payment_id=?",
      typeof pi === "string" ? pi : pi?.id || "",
    ).first<any>();
    if (!p) throw Error("Payment needs reconciliation before reversal");
    await env.DB.batch([
      sql(
        env,
        "INSERT OR IGNORE INTO ledger(owner,kind,amount,pool,business_key,payment_id,created_at) SELECT ?,'reversal',-(?-COUNT(*)),'paid',?,?,? FROM paid_allocations a JOIN reservations r ON r.job_id=a.job_id WHERE a.payment_id=? AND r.state!='released'",
        p.owner,
        p.credits,
        "reversal:" + p.session_id,
        p.session_id,
        now(),
        p.session_id,
      ),
      sql(env, "UPDATE principals SET review=1 WHERE id=?", p.owner),
      sql(
        env,
        "UPDATE purchases SET status='review' WHERE session_id=?",
        p.session_id,
      ),
      sql(
        env,
        "INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)",
        event.id,
        event.type,
        now(),
      ),
    ]);
  } else
    await sql(
      env,
      "INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)",
      event.id,
      event.type,
      now(),
    ).run();
}
