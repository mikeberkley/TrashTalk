import { describe, it, expect, vi, afterEach } from "vitest";
import { leagues } from "../packages/contracts/src/leagues";
import {
  featuredCandidate,
  rankFeatured,
  cachedFeaturedGames,
} from "../worker/src/providers/featured-games";
import { testEnv } from "./harness";
function event(id: string, period = 4, clock = "1:00", gap = 0, type = 2) {
  return {
    id,
    season: { type },
    competitions: [
      {
        status: {
          period,
          displayClock: clock,
          type: { state: "in", detail: "In Progress" },
        },
        competitors: [
          {
            homeAway: "home",
            score: String(gap),
            team: { id: "1", displayName: "Home" },
          },
          {
            homeAway: "away",
            score: "0",
            team: { id: "2", displayName: "Away" },
          },
        ],
      },
    ],
  };
}
const nfl = leagues[0];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("featured live games", () => {
  it("prefers late close games, then explicit postseason stakes, and caps at three", () => {
    const ranked = rankFeatured([
      featuredCandidate(event("early", 1), nfl),
      featuredCandidate(event("blowout", 4, "1:00", 35), nfl),
      featuredCandidate(event("close"), nfl),
      featuredCandidate(event("playoff", 4, "1:00", 0, 3), nfl),
    ]);
    expect(ranked.map((g) => g.providerId)).toEqual([
      "playoff",
      "close",
      "blowout",
    ]);
  });
  it("excludes final, delayed and missing-score games", () => {
    for (const detail of ["Final", "Delayed"]) {
      const e = event("bad");
      Object.assign(e.competitions[0].status.type, {
        detail,
        completed: detail === "Final",
      });
      expect(featuredCandidate(e, nfl)).toBeNull();
    }
    const e = event("bad");
    e.competitions[0].competitors[0].score = "";
    expect(featuredCandidate(e, nfl)).toBeNull();
  });
  it("uses sport-specific progress and stable tie breaks", () => {
    expect(
      featuredCandidate(event("ot", 5), nfl)!.featuredScore,
    ).toBeGreaterThan(featuredCandidate(event("normal"), nfl)!.featuredScore);
    expect(
      featuredCandidate(event("ninth", 9), leagues[2])!.featuredScore,
    ).toBeGreaterThan(
      featuredCandidate(event("first", 1), leagues[2])!.featuredScore,
    );
    expect(
      rankFeatured(
        ["b", "a"].map((id) => featuredCandidate(event(id), nfl)),
      ).map((g) => g.providerId),
    ).toEqual(["a", "b"]);
  });
  it("does not fetch again before ten minutes, including empty results; refreshes at expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T20:00:00Z"));
    const { env, db } = testEnv();
    db.exec("INSERT INTO leagues(id,enabled) VALUES('nfl',1)");
    const fetcher = vi.fn(async () => Response.json({ events: [] }));
    vi.stubGlobal("fetch", fetcher);
    await cachedFeaturedGames(env);
    vi.advanceTimersByTime(599_000);
    await cachedFeaturedGames(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await cachedFeaturedGames(env);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("caches feed failure without claiming there are no live games", async () => {
    const { env, db } = testEnv();
    db.exec("INSERT INTO leagues(id,enabled) VALUES('nfl',1)");
    const fetcher = vi.fn(async () => {
      throw Error("offline");
    });
    vi.stubGlobal("fetch", fetcher);
    expect((await cachedFeaturedGames(env)).unavailable).toBe(true);
    await cachedFeaturedGames(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
