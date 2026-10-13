import { it, expect } from "vitest";
import { testEnv } from "./harness";
import { recentCaptions } from "../worker/src/jobs/recent-captions";

it("supplies bounded global history, preserves legacy captions, and excludes unavailable jobs and private fields", async () => {
  const { env, db } = testEnv();
  const insert = db.prepare(
    "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,caption,deleted_at) VALUES(?,'private-owner',?,'h','{" +
      '"includeWord":"private"' +
      "}',?,?,0,?,?)",
  );
  for (let i = 0; i < 18; i++) {
    insert.run(
      `j${i}`,
      `key${i}`,
      "complete",
      i,
      JSON.stringify({
        text: `caption${i}`,
        visual: "scene",
        theme: "theme",
        owner: "secret",
      }),
      null,
    );
  }
  insert.run(
    "current",
    "current",
    "captioning",
    25,
    JSON.stringify({ text: "current", visual: "scene" }),
    null,
  );
  insert.run("deleted", "deleted", "complete", 24, "{}", 1);
  insert.run("failed", "failed", "failed", 23, "{}", null);
  insert.run("malformed", "malformed", "complete", 22, "broken", null);
  insert.run(
    "legacy",
    "legacy",
    "complete",
    21,
    JSON.stringify({ text: "legacy", visual: "gnomes" }),
    null,
  );
  const history = await recentCaptions(env, "current");
  expect(history[0]).toEqual({ text: "legacy", visual: "gnomes" });
  expect(history[1]).toEqual({
    text: "caption17",
    visual: "scene",
    theme: "theme",
  });
  expect(history).toHaveLength(14);
  expect(JSON.stringify(history)).not.toMatch(
    /secret|private|current|deleted|failed/,
  );
});
