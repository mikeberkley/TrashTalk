import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { newSession } from "../worker/src/auth";
import { testEnv } from "./harness";
import { stats, statDetails, pruneTraffic } from "../worker/src/stats";
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
    "INSERT INTO purchases VALUES('one','a','p1','paid',99,4,unixepoch()),('two','b','p2','review',99,4,unixepoch()); INSERT INTO traffic_daily VALUES(date('now'),3); INSERT INTO traffic_visitors(day,visitor) VALUES(date('now'),'a'),(date('now'),'b')",
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
  expect(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM traffic_ip_daily WHERE ip='174.44.103.190'",
      )
      .get()?.n,
  ).toBe(0);
  const views = await statDetails(env, "views", 30, 0),
    visitors = await statDetails(env, "visitors", 30, 0);
  expect(views?.rows.map((r: any) => r["IP address"]).sort()).toEqual([
    "203.0.113.1",
    "203.0.113.2",
  ]);
  expect(visitors?.rows.map((r: any) => r["IP addresses"]).sort()).toEqual([
    "203.0.113.1",
    "203.0.113.2",
  ]);
});

it("details match summary counts and paginate without duplicate accounts", async () => {
  const { env, db } = testEnv();
  for (let i = 0; i < 52; i++)
    db.prepare(
      "INSERT INTO principals(id,google_sub,created_at) VALUES(?,?,unixepoch()-?)",
    ).run("u" + i, "g" + i, i);
  db.exec(`INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,deleted_at) VALUES
 ('complete','u0','a','h','{}','complete',unixepoch(),unixepoch(),NULL),
 ('deleted','u0','b','h','{}','complete',unixepoch(),unixepoch(),unixepoch()),
 ('failed','u0','c','h','{}','failed',unixepoch(),unixepoch(),NULL),
 ('active','u1','d','h','{}','queued',unixepoch(),unixepoch(),NULL);
 INSERT INTO purchases VALUES('p1','u0','payment1','paid',99,4,unixepoch()),('p2','u1','payment2','review',99,4,unixepoch());
 INSERT INTO ledger(owner,kind,amount,pool,business_key,job_id,created_at) VALUES('u0','captured',0,'trial','capture1','complete',unixepoch()),('u0','captured',0,'paid','capture2','deleted',unixepoch());
 INSERT INTO shares VALUES('s1','complete',unixepoch(),1),('s2','deleted',unixepoch(),1);
 INSERT INTO traffic_daily VALUES(date('now'),7);
 INSERT INTO traffic_visitors(day,visitor) VALUES(date('now'),'browser');`);
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
    new Set(
      [...first!.rows, ...second!.rows].map((r: any) => r["Created (ET)"]),
    ).size,
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

it("retains aggregate views when IP records expire and does not double-count browser days across IPs", async () => {
  const { env, db } = testEnv();
  db.exec(`INSERT INTO traffic_daily VALUES('2000-01-01',5),(date('now'),4);
 INSERT INTO traffic_ip_daily(day,ip,views) VALUES('2000-01-01','192.0.2.1',5),(date('now'),'192.0.2.2',2),(date('now'),'192.0.2.3',1);
 INSERT INTO traffic_visitors(day,visitor) VALUES('2000-01-01','old'),(date('now'),'current');
 INSERT INTO traffic_visitor_ips VALUES('2000-01-01','old','192.0.2.1'),(date('now'),'current','192.0.2.2'),(date('now'),'current','192.0.2.3');`);
  await pruneTraffic(env);
  expect(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM traffic_ip_daily WHERE day='2000-01-01'",
      )
      .get()?.n,
  ).toBe(0);
  expect(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM traffic_visitor_ips WHERE day='2000-01-01'",
      )
      .get()?.n,
  ).toBe(0);
  const details = await statDetails(env, "views", 0, 0);
  expect(
    details?.rows.reduce((total: number, r: any) => total + r["Page views"], 0),
  ).toBe(9);
  expect(
    details?.rows.find((r: any) => r["Day (UTC)"] === "2000-01-01")?.[
      "IP address"
    ],
  ).toBe("Not recorded");
  const browsers = await statDetails(env, "visitors", 0, 0);
  expect(browsers?.rows).toHaveLength(1);
  expect(browsers?.rows[0]["Days visited"]).toBe(1);
  expect(browsers?.rows[0]["IP addresses"]).toContain("192.0.2.2");
  expect(browsers?.rows[0]["IP addresses"]).toContain("192.0.2.3");
});

it("looks up an IP once and reuses its saved location even after daily records expire", async () => {
  const { env, db } = testEnv();
  const { cacheIpLocation } = await import("../worker/src/stats");
  const lookup = vi.fn(() => ({
    city: "Burlington",
    region: "Vermont",
    country: "US",
  }));
  await cacheIpLocation(env, "192.0.2.20", lookup);
  await cacheIpLocation(env, "192.0.2.20", lookup);
  expect(lookup).toHaveBeenCalledTimes(1);
  await cacheIpLocation(env, "192.0.2.20", () => {
    throw Error("must reuse saved location");
  });
  db.exec(
    "INSERT INTO traffic_daily VALUES(date('now'),1);INSERT INTO traffic_ip_daily(day,ip,views) VALUES(date('now'),'192.0.2.20',1);INSERT INTO traffic_visitors(day,visitor) VALUES(date('now'),'browser');INSERT INTO traffic_visitor_ips VALUES(date('now'),'browser','192.0.2.20')",
  );
  const details = await statDetails(env, "views", 30, 0);
  expect(details?.rows[0]).toMatchObject({
    City: "Burlington",
    "State / region": "Vermont",
    Country: "US",
  });
  expect(
    (await statDetails(env, "visitors", 30, 0))?.rows[0].Locations,
  ).toContain("192.0.2.20: Burlington, Vermont, US");
  await pruneTraffic(env);
  expect(db.prepare("SELECT city FROM traffic_ip_locations").get()?.city).toBe(
    "Burlington",
  );
  const unknown = vi.fn(() => undefined);
  await cacheIpLocation(env, "192.0.2.21", unknown);
  await cacheIpLocation(env, "192.0.2.21", unknown);
  expect(unknown).toHaveBeenCalledTimes(1);
});
it("records Cloudflare location on the first counted request and never overwrites it", async () => {
  const { env, db } = testEnv();
  env.ASSETS = {
    fetch: async () =>
      new Response("<html>App</html>", {
        headers: { "Content-Type": "text/html" },
      }),
  };
  const pending: Promise<any>[] = [];
  const visit = async (city: string) => {
    const request = new Request("http://localhost/", {
      headers: { "CF-Connecting-IP": "192.0.2.30" },
    });
    Object.defineProperty(request, "cf", {
      value: { city, region: "Vermont", country: "US" },
    });
    expect(
      (
        await worker.fetch(request, env, {
          waitUntil: (p: Promise<any>) => pending.push(p),
        } as any)
      ).status,
    ).toBe(200);
    await Promise.all(pending);
  };
  await visit("Burlington");
  await visit("Montpelier");
  expect(
    db.prepare("SELECT city,state,country FROM traffic_ip_locations").get(),
  ).toMatchObject({ city: "Burlington", state: "Vermont", country: "US" });
  expect(db.prepare("SELECT views FROM traffic_ip_daily").get()?.views).toBe(2);
});

it("formats record timestamps in Eastern Time across daylight saving changes", async () => {
  const { formatEastern } = await import("../worker/src/stats");
  expect(formatEastern("2026-07-01T16:05:06Z")).toBe(
    "Jul 1, 2026, 12:05:06 PM EDT",
  );
  expect(formatEastern("2026-01-01T16:05:06Z")).toBe(
    "Jan 1, 2026, 11:05:06 AM EST",
  );
  expect(formatEastern("2026-07-01T02:05:06Z")).toBe(
    "Jun 30, 2026, 10:05:06 PM EDT",
  );
  const { env, db } = testEnv();
  db.exec(
    "INSERT INTO principals(id,google_sub,created_at) VALUES('a','google',1782921906)",
  );
  const accounts = await statDetails(env, "accounts", 0, 0);
  expect(accounts?.columns).toContain("Created (ET)");
  expect(accounts?.rows[0]["Created (ET)"]).toBe(
    formatEastern(1782921906 * 1000),
  );
  db.exec(
    "INSERT INTO traffic_daily VALUES('2026-07-01',2);INSERT INTO traffic_ip_daily(day,ip,views,first_seen,last_seen) VALUES('2026-07-01','192.0.2.1',2,1782921906,1782925506);INSERT INTO traffic_visitors(day,visitor,first_seen,last_seen) VALUES('2026-07-01','browser',1782921906,1782925506)",
  );
  const views = await statDetails(env, "views", 0, 0),
    visitors = await statDetails(env, "visitors", 0, 0);
  expect(views?.rows[0]["First visit (ET)"]).toBe(
    formatEastern(1782921906 * 1000),
  );
  expect(views?.rows[0]["Last visit (ET)"]).toBe(
    formatEastern(1782925506 * 1000),
  );
  expect(visitors?.rows[0]["First seen (ET)"]).toBe(
    formatEastern(1782921906 * 1000),
  );
});

it("sorts traffic by latest timestamp within a day and omits internal identifiers from all details", async () => {
  const { env, db } = testEnv();
  db.exec(`INSERT INTO traffic_daily VALUES('2026-07-01',2);
 INSERT INTO traffic_ip_daily(day,ip,views,first_seen,last_seen) VALUES('2026-07-01','192.0.2.1',1,1782921906,1782921906),('2026-07-01','192.0.2.2',1,1782921906,1782925506);
 INSERT INTO traffic_visitors(day,visitor,first_seen,last_seen) VALUES('2026-07-01','aaaa',1782921906,1782921906),('2026-07-01','zzzz',1782921906,1782925506);
 INSERT INTO traffic_visitor_ips VALUES('2026-07-01','aaaa','192.0.2.1'),('2026-07-01','zzzz','192.0.2.2');`);
  expect((await statDetails(env, "views", 0, 0))?.rows[0]["IP address"]).toBe(
    "192.0.2.2",
  );
  expect(
    (await statDetails(env, "visitors", 0, 0))?.rows[0]["IP addresses"],
  ).toBe("192.0.2.2");
  for (const metric of [
    "views",
    "visitors",
    "accounts",
    "completed",
    "retained",
    "attempts",
    "failed",
    "active",
    "packs",
    "credits",
    "amount",
    "review",
    "trial",
    "paid",
    "shares",
  ]) {
    const details = await statDetails(env, metric, 0, 0);
    expect(details?.columns[0], metric).toMatch(
      /^(Last visit|Last seen|Created|Used) \(ET\)$/,
    );
    const firstNonDate = details!.columns.findIndex(
      (col) => !col.endsWith("(ET)") && col !== "Day (UTC)",
    );
    if (firstNonDate >= 0)
      expect(
        details!.columns
          .slice(firstNonDate)
          .every((col) => !col.endsWith("(ET)") && col !== "Day (UTC)"),
      ).toBe(true);
    for (const forbidden of [
      "Account",
      "Google identifier",
      "Browser identifier",
      "Image",
      "Checkout",
    ]) {
      expect(details?.columns).not.toContain(forbidden);
      for (const row of details!.rows)
        expect(row).not.toHaveProperty(forbidden);
    }
  }
});
