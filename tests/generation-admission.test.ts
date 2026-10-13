import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("../worker/src/providers/cache", () => ({
  sharedGame: vi.fn(),
  cachedGame: vi.fn(),
}));
import { Coordinator } from "../worker/src/Coordinator";
import { sharedGame } from "../worker/src/providers/cache";
import { generationInputSchema } from "../packages/contracts/src/generation";
import { leagues } from "../packages/contracts/src/leagues";
import { participant } from "../worker/src/providers/espn";
import { testEnv } from "./harness";
import { newSession } from "../worker/src/auth";

afterEach(() => vi.clearAllMocks());
it.each(leagues)(
  "accepts the team IDs emitted by the $id provider",
  (league) => {
    const team = participant({ id: "17", displayName: "Team" }, league);
    expect(
      generationInputSchema.safeParse({
        gameId: `${league.id}:123`,
        favoriteTeamId: team.id,
      }).success,
    ).toBe(true);
  },
);
it.each([
  "espn:unknown:17",
  "espn:wnba:abc",
  "espn:wnba:17:extra",
  "espn:wnba:17\n",
  "other:wnba:17",
  "espn:college-football:-2",
])("rejects unsupported or malformed team ID %s", (favoriteTeamId) => {
  expect(
    generationInputSchema.safeParse({ gameId: "wnba:123", favoriteTeamId })
      .success,
  ).toBe(false);
});
it.each([
  ["wnba", "espn:wnba:17", "espn:wnba:5"],
  ["ncaaf", "espn:college-football:333", "espn:college-football:194"],
])(
  "admits a %s generation, pins both teams and reserves exactly one credit",
  async (league, favoriteTeamId, opponentId) => {
    const { env, db } = testEnv();
    const session = await newSession(env);
    db.prepare("INSERT INTO leagues(id,enabled) VALUES(?,1)").run(league);
    for (const id of [favoriteTeamId, opponentId]) {
      const metadata = {
        id,
        version: "v1",
        primary: "#000000",
        secondary: "#FFFFFF",
        logoHash: "logo",
        paletteHash: "palette",
      };
      db.prepare("INSERT INTO teams VALUES(?,?,?)").run(
        id,
        JSON.stringify(metadata),
        "v1",
      );
    }
    vi.mocked(sharedGame).mockResolvedValue({
      id: `${league}:123`,
      status: "final",
      home: { id: favoriteTeamId },
      away: { id: opponentId },
    });
    const send = vi.spyOn(env.JOBS, "send");
    const input = { gameId: `${league}:123`, favoriteTeamId, referenceIds: [] };
    const coordinator = { env } as unknown as Coordinator;
    await expect(
      Coordinator.prototype.admit.call(coordinator, {
        owner: session.owner,
        input: { ...input, favoriteTeamId: "espn:wnba:999" },
        idempotency: "non-participating-team",
      }),
    ).rejects.toThrow("Choose a participating team");
    const admitted = await Coordinator.prototype.admit.call(coordinator, {
      owner: session.owner,
      input,
      idempotency: "league-regression-test",
    });
    const row = db
      .prepare("SELECT status,input FROM jobs WHERE id=?")
      .get(admitted.id) as any;
    expect(row.status).toBe("queued");
    expect(JSON.parse(row.input)).toMatchObject({
      favoriteTeamId,
      teams: { home: { id: favoriteTeamId }, away: { id: opponentId } },
    });
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM reservations WHERE state='reserved'",
        )
        .get(),
    ).toMatchObject({ n: 1 });
    expect(send).toHaveBeenCalledWith({ id: admitted.id });
    const dupe = await Coordinator.prototype.admit.call(coordinator, {
      owner: session.owner,
      input,
      idempotency: "league-regression-test",
    });
    expect(dupe.id).toBe(admitted.id);
    expect(send).toHaveBeenCalledTimes(1);
  },
);
