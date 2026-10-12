import { it, expect, vi } from "vitest";
import Stripe from "stripe";
import { testEnv } from "./harness";
import { checkout, webhook } from "../worker/src/billing";
function fixture() {
  const { env, db } = testEnv();
  env.STRIPE_SECRET_KEY = "sk_test_fixture";
  env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  db.exec(
    "INSERT INTO principals(id,google_sub,created_at) VALUES('a','google',0)",
  );
  const api = new Stripe(env.STRIPE_SECRET_KEY);
  const session: any = {
    id: "cs_test_1",
    payment_status: "paid",
    mode: "payment",
    amount_total: 99,
    currency: "usd",
    client_reference_id: "a",
    metadata: { pack: "four-v1", owner: "a" },
    line_items: { data: [{ quantity: 1 }] },
    payment_intent: "pi_1",
  };
  vi.spyOn(api.checkout.sessions, "retrieve").mockResolvedValue(session);
  return { env, db, api, session };
}
async function deliver(
  f: any,
  id: string,
  type = "checkout.session.completed",
  object: any = { id: "cs_test_1" },
) {
  const body = JSON.stringify({ id, type, data: { object } });
  const sig = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: f.env.STRIPE_WEBHOOK_SECRET,
  });
  return webhook(f.env, body, sig, f.api);
}
it("signed duplicate and concurrent payment events credit exactly four", async () => {
  const f = fixture();
  await deliver(f, "evt1");
  await deliver(f, "evt1");
  await deliver(f, "evt2");
  expect(
    (
      f.db
        .prepare("SELECT SUM(amount) n FROM ledger WHERE pool='paid'")
        .get() as any
    ).n,
  ).toBe(4);
  expect(
    (f.db.prepare("SELECT COUNT(*) n FROM webhook_events").get() as any).n,
  ).toBe(2);
});
it("forged webhook cannot credit", async () => {
  const f = fixture();
  await expect(webhook(f.env, "{}", "t=123,v1=bogus", f.api)).rejects.toThrow();
  expect((f.db.prepare("SELECT COUNT(*) n FROM ledger").get() as any).n).toBe(
    0,
  );
});
it("unpaid checkout never grants credits", async () => {
  const f = fixture();
  f.session.payment_status = "unpaid";
  await deliver(f, "evt1");
  expect((f.db.prepare("SELECT COUNT(*) n FROM ledger").get() as any).n).toBe(
    0,
  );
});
it("wrong amount is rejected", async () => {
  const f = fixture();
  f.session.amount_total = 1;
  await expect(deliver(f, "evt1")).rejects.toThrow("Unexpected payment");
});
it("out-of-order duplicate completion cannot regrant a refunded pack", async () => {
  const f = fixture();
  await deliver(f, "evt1");
  await deliver(f, "refund", "charge.refunded", { payment_intent: "pi_1" });
  await deliver(f, "evt2");
  expect(
    (f.db.prepare("SELECT SUM(amount) n FROM ledger").get() as any).n,
  ).toBe(0);
  expect(
    (f.db.prepare("SELECT status FROM purchases").get() as any).status,
  ).toBe("review");
});
it("repeat packs use distinct business keys", async () => {
  const f = fixture();
  await deliver(f, "evt1");
  f.session.id = "cs_test_2";
  f.session.payment_intent = "pi_2";
  await deliver(f, "evt2", "checkout.session.completed", { id: "cs_test_2" });
  expect(
    (f.db.prepare("SELECT SUM(amount) n FROM ledger").get() as any).n,
  ).toBe(8);
});
it("a disputed spent pack does not reverse another pack", async () => {
  const f = fixture();
  await deliver(f, "evt1");
  for (let i = 0; i < 4; i++)
    f.db.exec(
      `INSERT INTO reservations VALUES('j${i}','a','paid','reserved');UPDATE reservations SET state='captured' WHERE job_id='j${i}'`,
    );
  f.session.id = "cs_test_2";
  f.session.payment_intent = "pi_2";
  await deliver(f, "evt2", "checkout.session.completed", { id: "cs_test_2" });
  await deliver(f, "dispute", "charge.dispute.created", {
    payment_intent: "pi_1",
  });
  expect(
    (f.db.prepare("SELECT SUM(amount) n FROM ledger").get() as any).n,
  ).toBe(4);
  expect(
    (f.db.prepare("SELECT review FROM principals WHERE id='a'").get() as any)
      .review,
  ).toBe(1);
});

it("checkout charges 99 cents and records a four-credit pending purchase", async () => {
  const f = fixture();
  const create = vi.spyOn(f.api.checkout.sessions, "create").mockResolvedValue({
    id: "cs_test_new",
    url: "https://checkout.stripe.com/test",
  } as any);
  expect(await checkout(f.env, "a", "test-key", f.api)).toBe(
    "https://checkout.stripe.com/test",
  );
  expect(create.mock.calls[0][0]).toMatchObject({
    mode: "payment",
    success_url:
      f.env.ORIGIN + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
    metadata: { pack: "four-v1", owner: "a" },
    line_items: [
      { quantity: 1, price_data: { currency: "usd", unit_amount: 99 } },
    ],
  });
  expect(
    f.db.prepare("SELECT amount,credits,status FROM purchases").get(),
  ).toMatchObject({ amount: 99, credits: 4, status: "pending" });
});
it("existing one-dollar checkout sessions retain their original price", async () => {
  const f = fixture();
  f.session.metadata.pack = "five-v1";
  f.session.amount_total = 100;
  await deliver(f, "legacy");
  expect(
    f.db.prepare("SELECT amount,credits FROM purchases").get(),
  ).toMatchObject({ amount: 100, credits: 5 });
});
it("new offer rejects the old price", async () => {
  const f = fixture();
  f.session.amount_total = 100;
  await expect(deliver(f, "wrong-price")).rejects.toThrow("Unexpected payment");
});

it("previous 99-cent packs still grant five and refund only their own credits", async () => {
  const f = fixture();
  f.session.metadata.pack = "five-v2";
  await deliver(f, "old-pack");
  expect(
    f.db.prepare("SELECT amount,credits FROM purchases").get(),
  ).toMatchObject({ amount: 99, credits: 5 });
  expect(
    (f.db.prepare("SELECT SUM(amount) n FROM ledger").get() as any).n,
  ).toBe(5);
  await deliver(f, "refund-old", "charge.refunded", { payment_intent: "pi_1" });
  expect(
    (f.db.prepare("SELECT SUM(amount) n FROM ledger").get() as any).n,
  ).toBe(0);
});
