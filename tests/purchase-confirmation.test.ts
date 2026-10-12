import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { testEnv } from "./harness";
import { newSession } from "../worker/src/auth";
it("purchase confirmation requires the owner and an actual credit grant", async () => {
  const { env, db } = testEnv();
  db.exec(
    "INSERT INTO principals(id,created_at) VALUES('owner',0),('other',0)",
  );
  const owner = await newSession(env, "owner"),
    other = await newSession(env, "other");
  db.exec(
    "INSERT INTO purchases VALUES('cs_test','owner',NULL,'pending',99,4,0)",
  );
  const call = (session = owner) =>
    worker.fetch(
      new Request("http://localhost/api/billing/purchases/cs_test", {
        headers: { Cookie: "tt_session=" + session.token },
      }),
      env,
      { waitUntil() {} } as any,
    );
  expect((await call(other)).status).toBe(404);
  expect(await (await call()).json()).toMatchObject({
    status: "pending",
    credited: 0,
  });
  db.exec("UPDATE purchases SET status='paid'");
  expect(await (await call()).json()).toMatchObject({
    status: "paid",
    credited: 0,
  });
  db.exec(
    "INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES('owner','grant',4,'paid','purchase:cs_test',0)",
  );
  expect(await (await call()).json()).toMatchObject({
    status: "paid",
    credited: 1,
    credits: 4,
    amount: 99,
  });
});
