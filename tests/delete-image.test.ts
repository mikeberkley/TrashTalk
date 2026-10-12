import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { testEnv } from "./harness";
import { newSession } from "../worker/src/auth";
it("only the owner can delete a completed meme; redirects the shared page and preserves accounting", async () => {
  const { env, db, objects } = testEnv();
  db.prepare(
    "INSERT INTO principals(id,created_at) VALUES('owner',0),('other',0)",
  ).run();
  const owner = await newSession(env, "owner"),
    other = await newSession(env, "other");
  db.prepare(
    "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,context,caption,artwork) VALUES('j','owner','key','hash',?,'complete',0,0,?,?, 'artwork/j')",
  ).run(
    JSON.stringify({ gameId: "nfl:123", favoriteTeamId: "espn:football:1" }),
    JSON.stringify({ away: { displayName: "A" }, home: { displayName: "B" } }),
    JSON.stringify({ text: "Caption" }),
  );
  db.prepare("INSERT INTO shares VALUES('public','j',0,1)").run();
  db.prepare(
    "INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES('owner','grant',3,'trial','grant',0)",
  ).run();
  db.prepare(
    "INSERT INTO reservations VALUES('j','owner','trial','captured')",
  ).run();
  objects.set("artwork/j", { bytes: new Uint8Array([1, 2, 3]) });
  const balanceBefore = db
    .prepare("SELECT SUM(amount) AS n FROM ledger")
    .get()?.n;
  const pending: Promise<any>[] = [];
  const call = (path: string, method = "GET", session = owner) =>
    worker.fetch(
      new Request("http://localhost" + path, {
        method,
        headers: {
          Cookie: "tt_session=" + session.token,
          Origin: "http://localhost",
          "X-CSRF-Token": session.csrf,
        },
      }),
      env,
      { waitUntil: (p: Promise<any>) => pending.push(p) } as any,
    );
  expect((await call("/api/generations/j", "DELETE", other)).status).toBe(404);
  expect(
    db.prepare("SELECT deleted_at FROM jobs").get()?.deleted_at,
  ).toBeNull();
  expect((await call("/api/generations/j", "DELETE")).status).toBe(200);
  await Promise.all(pending);
  expect(objects.has("artwork/j")).toBe(false);
  expect(db.prepare("SELECT COUNT(*) AS n FROM shares").get()?.n).toBe(1);
  expect(db.prepare("SELECT state FROM reservations").get()?.state).toBe(
    "captured",
  );
  expect(db.prepare("SELECT SUM(amount) AS n FROM ledger").get()?.n).toBe(
    balanceBefore,
  );
  expect(await (await call("/api/my-images")).json()).toEqual([]);
  for (const path of [
    "/api/generations/j",
    "/api/generations/j/image",
    "/m/public/image",
  ])
    expect((await call(path)).status).toBe(404);
  expect((await call("/api/generations/j/share", "POST")).status).toBe(404);
  const redirect = await call("/m/public");
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("Location")).toBe("/");
  expect(redirect.headers.get("Cache-Control")).toBe("no-store");
  expect(await redirect.text()).not.toContain("Caption");
  const previousDeletion = await call("/m/previously-removed-token");
  expect(previousDeletion.status).toBe(302);
  expect(previousDeletion.headers.get("Location")).toBe("/");
});
