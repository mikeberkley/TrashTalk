import { it, expect, vi } from "vitest";
import fs from "node:fs";
import { testEnv } from "./harness";
import { loadPinnedTeams } from "../worker/src/jobs/preparation";
import { GenerationTiming } from "../worker/src/jobs/timing";

it("starts both logo reads concurrently and rejects corrupt pinned assets", async () => {
  const { env, db, objects } = testEnv();
  const catalog = JSON.parse(
    fs.readFileSync("tests/fixtures/team-versions.json", "utf8"),
  ).slice(0, 2);
  const pins: any = {};
  for (const [i, side] of ["away", "home"].entries()) {
    const row = catalog[i],
      m = row.metadata;
    pins[side] = { id: m.id, version: m.version };
    db.prepare("INSERT INTO team_versions VALUES(?,?,?,?,?,?)").run(
      m.id,
      m.version,
      m.logoKey,
      m.logoHash,
      m.paletteHash,
      JSON.stringify(m),
    );
    objects.set(m.logoKey, { bytes: fs.readFileSync(row.pngPath) });
  }
  const originalGet = env.MEDIA.get.bind(env.MEDIA);
  const releases: Array<() => void> = [];
  const reads = vi
    .spyOn(env.MEDIA, "get")
    .mockImplementation(async (key: any) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return originalGet(key);
    });
  const pending = loadPinnedTeams(env, pins);
  await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
  releases.forEach((release) => release());
  const result = await pending;
  expect(result.away.logo).toMatch(/^data:image\/png;base64,/);
  expect(result.home.team.version).toBe(pins.home.version);
  reads.mockRestore();
  objects.set(catalog[0].metadata.logoKey, {
    bytes: new Uint8Array([1, 2, 3]),
  });
  await expect(loadPinnedTeams(env, pins)).rejects.toThrow(
    "Logo hash mismatch",
  );
});

it("records elapsed stages including failed work without exposing content", async () => {
  const { env, db } = testEnv();
  let clock = 10000;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  try {
    const timing = new GenerationTiming(9);
    clock += 20;
    timing.next("captionProvider");
    clock += 80;
    await timing.persist(env, "job", "failed", {
      caption: "grok",
      image: "imagine",
    });
    const detail = JSON.parse(
      (
        db
          .prepare("SELECT detail FROM audit WHERE kind='generation_timing'")
          .get() as any
      ).detail,
    );
    expect(detail).toMatchObject({
      outcome: "failed",
      attemptMs: 100,
      jobAgeAtStartMs: 1000,
      stagesMs: { initialization: 20, captionProvider: 80 },
    });
    env.DB.prepare = () => {
      throw Error("DB unavailable");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      timing.persist(env, "job", "complete", {
        caption: "grok",
        image: "imagine",
      }),
    ).resolves.toBeUndefined();
    log.mockRestore();
  } finally {
    spy.mockRestore();
  }
});
