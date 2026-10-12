import { it, expect } from "vitest";
import { testEnv } from "./harness";
import { linkGoogle } from "../worker/src/auth";
it("merges favorites into an existing Google account without duplicates", async () => {
  const { env } = testEnv();
  await env.DB.prepare(
    "INSERT INTO principals(id,google_sub,created_at) VALUES('anon',NULL,0),('account','google-user',0)",
  ).run();
  await env.DB.prepare(
    "INSERT INTO teams VALUES('team-a','{}','v1'),('team-b','{}','v1')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO favorites VALUES('anon','team-a'),('anon','team-b'),('account','team-a')",
  ).run();
  expect(await linkGoogle(env, "anon", "google-user")).toBe("account");
  const result = await env.DB.prepare(
    "SELECT owner,team_id FROM favorites ORDER BY team_id",
  ).all();
  expect(result.results).toEqual([
    { owner: "account", team_id: "team-a" },
    { owner: "account", team_id: "team-b" },
  ]);
});
