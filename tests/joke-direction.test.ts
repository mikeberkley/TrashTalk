import { it, expect } from "vitest";
import { captionInput } from "../packages/trash-talk/src/game-context";
import {
  jokeDirection,
  recentThemes,
} from "../packages/trash-talk/src/joke-direction";

const context = (status: string, favorite = "home", sport = "football") => ({
  favorite,
  sport,
  away: {},
  home: {},
  gameContext: {
    status,
    score: { home: 17, away: 19 },
    period: 4,
    clock: "2:00",
    periodDisplay: "Q4",
  },
});

it.each([
  ["final", "home", "lost"],
  ["final", "away", "won"],
  ["live", "home", "trailing"],
  ["live", "away", "leading"],
])(
  "summarizes %s from the %s perspective without raw scores",
  (status, favorite, outcome) => {
    const input = captionInput(context(status, favorite));
    expect(input.gameContext).toMatchObject({
      status,
      outcome,
      margin: "narrow",
    });
    expect(JSON.stringify(input)).not.toMatch(/17|19|score|capturedAt/);
    if (status === "live")
      expect(input.gameContext).toMatchObject({
        period: 4,
        clock: "2:00",
        phase: "Q4",
      });
    else expect(input.gameContext).not.toHaveProperty("clock");
  },
);

it("handles pregame, ties, clear margins and soccer shootout winners", () => {
  expect(captionInput(context("upcoming")).gameContext).toEqual({
    status: "upcoming",
  });
  const c = context("final", "home", "soccer");
  c.gameContext.score = { home: 2, away: 2 };
  expect(captionInput(c).gameContext).toEqual({
    status: "final",
    outcome: "draw",
  });
  expect(
    captionInput({
      ...c,
      gameContext: { ...c.gameContext, penalties: { home: 5, away: 4 } },
    }).gameContext,
  ).toEqual({ status: "final", outcome: "won", margin: "penalty shootout" });
  c.gameContext.status = "live";
  expect(captionInput(c).gameContext).toMatchObject({ outcome: "tied" });
  c.gameContext.score.home = 5;
  expect(captionInput(c).gameContext).toMatchObject({ margin: "clear" });
});

it.each([
  { status: "upcoming" },
  { status: "live", outcome: "leading" },
  { status: "live", outcome: "trailing" },
  { status: "final", outcome: "won" },
  { status: "final", outcome: "lost" },
  { status: "final", outcome: "draw" },
  undefined,
])(
  "rotates eligible mechanisms without immediate repetition for %j",
  (situation) => {
    const history: { mechanism: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const choice = jokeDirection(situation, history, `job-${i}`);
      expect(choice.id).not.toBe(history[0]?.mechanism);
      if (situation?.status !== "upcoming")
        expect(choice.id).not.toBe("prediction");
      if (situation?.outcome !== "won")
        expect(choice.id).not.toBe("celebration");
      if (situation?.outcome !== "leading")
        expect(choice.id).not.toBe("premature");
      if (!["lost", "trailing"].includes(situation?.outcome || ""))
        expect(choice.id).not.toBe("excuse");
      history.unshift({ mechanism: choice.id });
    }
    expect(new Set(history.slice(-4).map((r) => r.mechanism)).size).toBe(4);
  },
);

it("keeps avoidance hints compact and strips score pairs", () => {
  expect(
    recentThemes([
      { theme: "17-19 food joke" },
      { theme: "17-19 food joke" },
      {},
    ]),
  ).toEqual(["food joke"]);
  expect(
    recentThemes(
      Array.from({ length: 15 }, (_, i) => ({ theme: `theme ${i}` })),
    ),
  ).toHaveLength(6);
});
