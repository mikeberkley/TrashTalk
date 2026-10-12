import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { newSession } from "../worker/src/auth";
import { testEnv } from "./harness";
import { stats, statDetails } from "../worker/src/stats";
it("only the configured Google account sees the admin flag and stats", async () => {
  const { env, db } = testEnv();
  env.ADMIN_GOOGLE_SUB = "admin";
  db.exec(
    "INSERT INTO principals(id,google_sub,created_at) VALUES('a','admin',0),('b','other',0),('c',NULL,0)",
  );
  for (const id of ["a", "b", "c"]) {
    const s = await newSession(env, id);
    const req = (p: string) =>
      worker.fetch(
        new Request("http://localhost" + p, {
          headers: { Cookie: "tt_session=" + s.token },
        }),
        env,
        {} as any,
      );
    expect(((await (await req("/api/me")).json()) as any).admin).toBe(
      id === "a",
    );
    expect((await req("/api/admin/stats")).status).toBe(id === "a" ? 200 : 403);
    expect((await req("/api/admin/stats/accounts")).status).toBe(
      id === "a" ? 200 : 403,
    );
    if (id === "a")
      expect((await req("/api/admin/stats?days=5")).status).toBe(400);
  }
  env.ADMIN_GOOGLE_SUB = undefined;
  const s = await newSession(env, "a");
  expect(
    (
      await worker.fetch(
        new Request("http://localhost/api/admin/stats", {
          headers: { Cookie: "tt_session=" + s.token },
        }),
        env,
        {} as any,
      )
    ).status,
  ).toBe(403);
});
it("aggregates traffic and paid purchases without counting review purchases", async () => {
  const { env, db } = testEnv();
  db.exec(
    "INSERT INTO purchases VALUES('one','a','p1','paid',99,4,unixepoch()),('two','b','p2','review',99,4,unixepoch()); INSERT INTO traffic_daily VALUES(date('now'),3); INSERT INTO traffic_visitors VALUES(date('now'),'a'),(date('now'),'b')",
  );
  const s = await stats(env, 30);
  expect(s.purchases).toEqual({ packs: 1, grossCents: 99, credits: 4 });
  expect(s.review.purchases).toBe(1);
  expect(s.traffic.views).toBe(3);
  expect(s.traffic.visitors).toBe(2);
});

it("excludes the home IP and authenticated operator while counting other visitors", async () => {
  const { env, db } = testEnv();
  env.STATS_EXCLUDED_IPS = "174.44.103.190";
  env.ADMIN_GOOGLE_SUB = "admin";
  db.exec(
    "INSERT INTO principals(id,google_sub,created_at) VALUES('admin','admin',0),('other','other',0)",
  );
  const admin = await newSession(env, "admin"),
    other = await newSession(env, "other");
  env.ASSETS = {
    fetch: async () =>
      new Response("<html>App</html>", {
        headers: { "Content-Type": "text/html" },
      }),
  };
  const pending: Promise<any>[] = [];
  const visit = async (ip: string, token?: string) => {
    const r = await worker.fetch(
      new Request("http://localhost/", {
        headers: {
          "CF-Connecting-IP": ip,
          ...(token ? { Cookie: "tt_session=" + token } : {}),
        },
      }),
      env,
      { waitUntil: (p: Promise<any>) => pending.push(p) } as any,
    );
    expect(r.status).toBe(200);
    await Promise.all(pending);
  };
  await visit("174.44.103.190");
  await visit("203.0.113.1", admin.token);
  expect(db.prepare("SELECT COUNT(*) AS n FROM traffic_daily").get()?.n).toBe(
    0,
  );
  await visit("203.0.113.1", other.token);
  await visit("203.0.113.2");
  expect(db.prepare("SELECT views FROM traffic_daily").get()?.views).toBe(2);
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM traffic_visitors").get()?.n,
  ).toBe(2);
});

it("details match summary counts and paginate without duplicate accounts", async () => {
  const { env, db } = testEnv();
  for (let i = 0; i < 52; i++)
    db.prepare(
      "INSERT INTO principals(id,google_sub,created_at) VALUES(?,?,unixepoch())",
    ).run("u" + i, "g" + i);
  db.exec(`INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,deleted_at) VALUES
 ('complete','u0','a','h','{}','complete',unixepoch(),unixepoch(),NULL),
 ('deleted','u0','b','h','{}','complete',unixepoch(),unixepoch(),unixepoch()),
 ('failed','u0','c','h','{}','failed',unixepoch(),unixepoch(),NULL),
 ('active','u1','d','h','{}','queued',unixepoch(),unixepoch(),NULL);
 INSERT INTO purchases VALUES('p1','u0','payment1','paid',99,4,unixepoch()),('p2','u1','payment2','review',99,4,unixepoch());
 INSERT INTO ledger(owner,kind,amount,pool,business_key,job_id,created_at) VALUES('u0','captured',0,'trial','capture1','complete',unixepoch()),('u0','captured',0,'paid','capture2','deleted',unixepoch());
 INSERT INTO shares VALUES('s1','complete',unixepoch(),1),('s2','deleted',unixepoch(),1);
 INSERT INTO traffic_daily VALUES(date('now'),7);
 INSERT INTO traffic_visitors VALUES(date('now'),'browser');`);
  const s = await stats(env, 30);
  for (const [metric, count] of Object.entries({
    completed: s.images.completed,
    retained: s.images.retained,
    attempts: s.images.attempts,
    failed: s.images.failed,
    active: s.images.active,
    packs: s.purchases.packs,
    review: s.review.purchases,
    trial: 1,
    paid: 1,
    shares: s.shares.published,
    visitors: s.traffic.visitors,
  })) {
    const d = await statDetails(env, metric, 30, 0);
    expect(d?.rows.length, metric).toBe(count);
  }
  const first = await statDetails(env, "accounts", 30, 0),
    second = await statDetails(env, "accounts", 30, 50);
  expect(first?.rows).toHaveLength(50);
  expect(first?.nextOffset).toBe(50);
  expect(second?.rows).toHaveLength(2);
  expect(second?.nextOffset).toBeNull();
  expect(
    new Set([...first!.rows, ...second!.rows].map((r: any) => r.Account)).size,
  ).toBe(52);
  expect((await statDetails(env, "credits", 30, 0))?.rows[0].Credits).toBe(
    s.purchases.credits,
  );
  expect((await statDetails(env, "amount", 30, 0))?.rows[0].Amount).toBe(
    "$0.99",
  );
  expect((await statDetails(env, "views", 30, 0))?.rows[0]["Page views"]).toBe(
    s.traffic.views,
  );
  expect(await statDetails(env, "invalid", 30, 0)).toBeNull();
  const admin = await newSession(env, "u0");
  env.ADMIN_GOOGLE_SUB = "g0";
  for (const path of [
    "accounts?offset=-1",
    "accounts?offset=1.5",
    "accounts?days=1",
    "invalid",
  ]) {
    const response = await worker.fetch(
      new Request("http://localhost/api/admin/stats/" + path, {
        headers: { Cookie: "tt_session=" + admin.token },
      }),
      env,
      {} as any,
    );
    expect(response.status).toBe(path === "invalid" ? 404 : 400);
  }
});
