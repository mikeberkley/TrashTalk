import { it, expect } from "vitest";
import fs from "node:fs";
import { testEnv } from "./harness";
import { newSession } from "../worker/src/auth";

it("starts new users with five credits and does not regrant on session rotation", async () => {
  const { env, db } = testEnv();
  const session = await newSession(env);
  await newSession(env, session.owner);
  expect(
    (
      db
        .prepare(
          "SELECT SUM(amount) n FROM ledger WHERE owner=? AND pool='trial'",
        )
        .get(session.owner) as any
    ).n,
  ).toBe(5);
});

it("upgrades existing users once, preserving spending, paid credits and merged identities", () => {
  const { db } = testEnv();
  db.exec(`
    INSERT INTO principals(id,created_at,merged_into) VALUES('existing',0,NULL),('merged',0,'existing'),('new',0,NULL);
    INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES
      ('existing','grant',3,'trial','trial:existing',0),
      ('existing','reservation',-3,'trial','spent',0),
      ('existing','grant',4,'paid','purchase:test',0),
      ('merged','grant',3,'trial','trial:merged',0),
      ('new','grant',5,'trial','trial:new',0);
  `);
  const migration = fs.readFileSync(
    "worker/migrations/0016_five_free_credits.sql",
    "utf8",
  );
  db.exec(migration);
  db.exec(migration);
  expect(
    (
      db
        .prepare(
          "SELECT SUM(amount) n FROM ledger WHERE owner='existing' AND pool='trial'",
        )
        .get() as any
    ).n,
  ).toBe(2);
  expect(
    (
      db
        .prepare("SELECT SUM(amount) n FROM ledger WHERE pool='paid'")
        .get() as any
    ).n,
  ).toBe(4);
  expect(
    (
      db
        .prepare(
          "SELECT COUNT(*) n FROM ledger WHERE business_key LIKE 'trial-five-upgrade:%'",
        )
        .get() as any
    ).n,
  ).toBe(1);
});
