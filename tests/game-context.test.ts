import { it, expect } from "vitest";
import {
  scoreContext,
  captionInput,
} from "../packages/trash-talk/src/game-context";
const at = Date.parse("2026-10-12T20:00:00Z");
const game = (overrides: any = {}) => ({
  status: "live",
  date: "2026-10-12T19:00:00Z",
  capturedAt: new Date(at).toISOString(),
  score: { home: 0, away: 7 },
  period: 1,
  clock: "10:00",
  periodDisplay: "Q1 · 10:00",
  sport: "football",
  ...overrides,
});
it("requires both ESPN live status and the half-open four-hour window", () => {
  expect(scoreContext(game(), at)).toMatchObject({
    status: "live",
    score: { home: 0, away: 7 },
  });
  expect(
    scoreContext(game({ date: new Date(at).toISOString() }), at)?.status,
  ).toBe("live");
  for (const data of [
    { status: "scheduled" },
    { status: "unavailable" },
    { date: new Date(at + 1).toISOString() },
    { date: new Date(at - 4 * 3600000).toISOString() },
    { date: "bad" },
  ])
    expect(scoreContext(game(data), at)).toBeUndefined();
});
it("accepts final scores outside the live window, ties, and soccer shootouts", () => {
  const final = game({
    status: "final",
    date: "2026-10-10T19:00:00Z",
    score: { home: 2, away: 2 },
    sport: "soccer",
    penalties: { home: 4, away: 5 },
  });
  expect(scoreContext(final, at)).toEqual({
    status: "final",
    score: { home: 2, away: 2 },
    penalties: { home: 4, away: 5 },
    capturedAt: new Date(at).toISOString(),
  });
});
it("omits missing, stale, future-dated, or invalid scores", () => {
  for (const data of [
    null,
    game({ capturedAt: new Date(at - 31000).toISOString() }),
    game({ capturedAt: new Date(at + 6000).toISOString() }),
    game({ capturedAt: "bad" }),
    game({ score: { home: null, away: 7 } }),
    game({ score: { home: NaN, away: 7 } }),
    game({ score: { home: -1, away: 7 } }),
    game({ score: { home: "0", away: 7 } }),
  ])
    expect(scoreContext(data, at)).toBeUndefined();
});
it("allowlists team identities and optional scoreboard, excluding all other game data", () => {
  const team = {
    id: "private-id",
    name: "Team",
    displayName: "Team A",
    city: "City",
    abbr: "A",
    logo: "private-logo",
    statistics: "secret",
  };
  const base = {
    league: "nfl",
    leagueLabel: "NFL",
    sport: "football",
    favorite: "home",
    away: team,
    home: team,
    score: { home: 7, away: 0 },
    status: "final",
    date: "yesterday",
    briefing: "old research",
    research: "old search",
    moment: "old play",
    stats: "old stats",
    gameContext: undefined,
  };
  const input = captionInput(base);
  expect(Object.keys(input)).toEqual([
    "league",
    "leagueLabel",
    "sport",
    "favorite",
    "away",
    "home",
  ]);
  expect(Object.keys(input.home)).toEqual([
    "name",
    "displayName",
    "city",
    "abbr",
  ]);
  expect(
    captionInput({ ...base, gameContext: scoreContext(game(), at) }).gameContext
      .score,
  ).toEqual({ home: 0, away: 7 });
});

it("a generation freshness request bypasses an otherwise-valid scoreboard cache", async () => {
  const { testEnv } = await import("./harness");
  const { cachedGame } = await import("../worker/src/providers/cache");
  const { espn } = await import("../worker/src/providers/espn");
  const { vi } = await import("vitest");
  const { env, db } = testEnv();
  const old = { ...game(), score: { home: 0, away: 0 } },
    current = { ...game(), score: { home: 14, away: 7 } };
  db.prepare("INSERT INTO cache VALUES(?,?,?)").run(
    "game:nfl:123",
    JSON.stringify(old),
    Math.floor(Date.now() / 1000) + 300,
  );
  const spy = vi.spyOn(espn, "getGame").mockResolvedValue(current as any);
  try {
    expect((await cachedGame(env, "nfl:123")).score).toEqual(old.score);
    expect(spy).not.toHaveBeenCalled();
    expect((await cachedGame(env, "nfl:123", true)).score).toEqual(
      current.score,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(db.prepare("SELECT value FROM cache").get()!.value as string)
        .score,
    ).toEqual(current.score);
  } finally {
    spy.mockRestore();
  }
});

it("supplies upcoming status for fresh future scheduled games without a score", () => {
  const upcoming = game({ status: "scheduled", date: new Date(at + 3600000).toISOString(), score: { home: null, away: null } });
  expect(scoreContext(upcoming, at)).toEqual({ status: "upcoming" });
  expect(captionInput({ gameContext: scoreContext(upcoming, at), home: {}, away: {} }).gameContext).toEqual({ status: "upcoming" });
  expect(scoreContext({ ...upcoming, capturedAt: new Date(at - 31000).toISOString() }, at)).toBeUndefined();
  expect(scoreContext({ ...upcoming, date: "bad" }, at)).toBeUndefined();
  expect(scoreContext({ ...upcoming, date: new Date(at).toISOString() }, at)).toBeUndefined();
});
