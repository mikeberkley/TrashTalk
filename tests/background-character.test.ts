import { expect, it } from "vitest";
import {
  backgroundCharacters,
  backgroundPeople,
  backgroundObjects,
  backgroundInstruction,
  selectBackgroundCharacter,
} from "../packages/trash-talk/src/background-character";
import { chooseBackgroundCharacter } from "../worker/src/jobs/background-character";
import { testEnv } from "./harness";

it("alternates categories and exhausts all 48 characters before repeating", () => {
  const history: string[] = [];
  for (let i = 0; i < 144; i++) {
    const selected = selectBackgroundCharacter(history, `job-${i}`);
    expect(i % 2 ? backgroundObjects : backgroundPeople).toContain(selected);
    expect(history.slice(0, 47)).not.toContain(selected);
    history.unshift(selected);
  }
  expect(new Set(history.slice(0, 48)).size).toBe(48);
  expect(new Set(backgroundCharacters).size).toBe(48);
  expect(selectBackgroundCharacter([], "stable")).toBe(
    selectBackgroundCharacter([], "stable"),
  );
});
it("requests the selected cameo and anthropomorphizes only objects", () => {
  expect(backgroundInstruction("Parking meter")).toContain(
    "anthropomorphic parking meter",
  );
  expect(backgroundInstruction("Doctor")).toContain("a doctor");
  expect(backgroundInstruction("Doctor")).not.toContain("anthropomorphic");
  expect(backgroundInstruction("Doctor")).toContain(
    "exactly one small background cameo",
  );
  expect(() => backgroundInstruction("unknown")).toThrow();
});
it("uses global history beyond 15 jobs and preserves the selection for retries", async () => {
  const { env, db } = testEnv();
  const insert = db.prepare(
    "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,context) VALUES(?,'owner',?,'hash','{}','complete',?,0,?)",
  );
  const history: string[] = [];
  for (let i = 0; i < 48; i++) {
    const name = await chooseBackgroundCharacter(env, `job-${i}`);
    expect(history).not.toContain(name);
    history.push(name);
    insert.run(
      `job-${i}`,
      `key-${i}`,
      i,
      JSON.stringify({ backgroundCharacter: name }),
    );
  }
  expect(await chooseBackgroundCharacter(env, "next")).toBe(history[0]);
  expect(await chooseBackgroundCharacter(env, "retry", "job-20")).toBe(
    history[20],
  );
  insert.run("legacy", "legacy", 50, "malformed");
  expect(await chooseBackgroundCharacter(env, "next")).toBe(history[0]);
});
