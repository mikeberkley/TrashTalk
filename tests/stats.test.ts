import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { newSession } from "../worker/src/auth";
import { testEnv } from "./harness";
import { stats } from "../worker/src/stats";
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
