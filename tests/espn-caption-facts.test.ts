import { expect, it } from "vitest";
import { extractCaptionFacts } from "../worker/src/providers/caption-facts";
import {
  captionInput,
  compactFacts,
  scoreContext,
} from "../packages/trash-talk/src/game-context";
import { captionBase } from "../packages/trash-talk/src/prompts";
const athlete = (displayName: string) => ({ displayName });
const header = {
  competitions: [
    {
      competitors: [
        {
          team: { id: "1" },
          homeAway: "home",
          record: [{ type: "total", summary: "4-1" }],
        },
        {
          team: { id: "2" },
          homeAway: "away",
          record: [{ type: "total", summary: "1-4" }],
        },
      ],
    },
  ],
};
const leaders = [
  {
    team: { id: "1" },
    leaders: [
      {
        name: "passingYards",
        displayName: "Passing Yards",
        leaders: [
          { athlete: athlete("Season Leader"), displayValue: "1200 YDS" },
        ],
      },
    ],
  },
];
it("keeps pre-game leaders and probable starters distinct from game performances, with availability", () => {
  const s = {
    header: structuredClone(header),
    leaders,
    injuries: [
      {
        team: { id: "1" },
        injuries: [{ athlete: athlete("Season Leader"), status: "Out" }],
      },
    ],
  };
  const facts = extractCaptionFacts(s, "football", "scheduled");
  expect(facts.players[0]).toEqual({
    side: "home",
    name: "Season Leader",
    detail: "Out; pre-game Passing Yards leader: 1200 YDS",
  });
  expect(facts.teams).toContain("home record 4-1");
  expect(facts.moments).toEqual([]);
  (s.header.competitions[0].competitors[1] as any).probables = [
    {
      athlete: athlete("Probable Pitcher"),
      displayName: "Probable Starting Pitcher",
    },
  ];
  expect(
    extractCaptionFacts(s, "baseball", "scheduled").players,
  ).toContainEqual({
    side: "away",
    name: "Probable Pitcher",
    detail: "Probable Starting Pitcher",
  });
});
it.each(["live", "final"])(
  "uses actual %s player performances and excludes DNP and foreign teams",
  (status) => {
    const s = {
      header,
      leaders,
      boxscore: {
        players: [
          {
            team: { id: "1" },
            statistics: [
              {
                keys: ["points"],
                athletes: [
                  {
                    athlete: athlete("Benched Star"),
                    didNotPlay: true,
                    stats: ["99"],
                  },
                  { athlete: athlete("Actual Scorer"), stats: ["28"] },
                ],
              },
            ],
          },
          {
            team: { id: "999" },
            statistics: [
              {
                keys: ["points"],
                athletes: [{ athlete: athlete("Wrong Team"), stats: ["100"] }],
              },
            ],
          },
        ],
      },
    };
    const facts = extractCaptionFacts(s, "basketball", status);
    expect(facts.players[0]).toEqual({
      side: "home",
      name: "Actual Scorer",
      detail: "game points: 28",
    });
    expect(JSON.stringify(facts)).not.toMatch(/Benched Star|Wrong Team|1200/);
    expect(facts.players[1].detail).toContain("participation unconfirmed");
  },
);
it("never labels home runs allowed by a pitcher as home runs hit", () => {
  const facts = extractCaptionFacts(
    {
      header,
      boxscore: {
        players: [
          {
            team: { id: "1" },
            statistics: [
              {
                type: "pitching",
                keys: ["homeRuns", "strikeouts"],
                athletes: [{ athlete: athlete("Pitcher"), stats: ["3", "8"] }],
              },
              {
                type: "batting",
                keys: ["homeRuns", "RBIs"],
                athletes: [{ athlete: athlete("Hitter"), stats: ["1", "3"] }],
              },
            ],
          },
        ],
      },
    },
    "baseball",
    "final",
  );
  expect(facts.players.find((p) => p.name === "Pitcher")?.detail).toBe(
    "game pitching strikeouts: 8",
  );
  expect(facts.players.find((p) => p.name === "Hitter")?.detail).toBe(
    "game homeRuns: 1",
  );
});
it("extracts soccer scorers from roster match stats", () => {
  const facts = extractCaptionFacts(
    {
      header,
      rosters: [
        {
          team: { id: "2" },
          roster: [
            {
              athlete: athlete("Scorer"),
              stats: [
                {
                  name: "totalGoals",
                  displayName: "Goals",
                  value: 2,
                  displayValue: "2",
                },
              ],
            },
          ],
        },
      ],
    },
    "soccer",
    "final",
  );
  expect(facts.players).toEqual([
    { side: "away", name: "Scorer", detail: "game Goals: 2" },
  ]);
});
it("omits invalidated plays, keeps highlights bounded, and never leaks live plays into pregame", () => {
  const s = {
    header,
    plays: [
      { text: "Touchdown overturned" },
      { text: "Touchdown", hidden: true },
      { text: "A real touchdown", scoringPlay: true },
      { text: "A fumble", noPlay: true },
    ],
  };
  expect(extractCaptionFacts(s, "football", "live").moments).toEqual([
    "A real touchdown",
  ]);
  expect(extractCaptionFacts(s, "football", "scheduled").moments).toEqual([]);
  expect(extractCaptionFacts(s, "football", "unavailable").players).toEqual([]);
  expect(extractCaptionFacts(undefined, "football", "live")).toEqual({
    players: [],
    teams: [],
    moments: [],
  });
});
it("bounds prompt context, prioritizes both teams, and requires fresh valid game context", () => {
  const facts = {
    players: [
      { side: "home", name: "Home Player", detail: "game points: 30" },
      { side: "away", name: "Away Player", detail: "game points: 25" },
    ],
    teams: Array(50).fill("long record " + "x".repeat(100)),
    moments: ["x".repeat(500)],
  };
  const compact = compactFacts(facts)!;
  expect(compact[0]).toContain("Home Player");
  expect(compact[1]).toContain("Away Player");
  expect(JSON.stringify(compact).length).toBeLessThanOrEqual(420);
  // Rich facts replace prose: serialized facts plus instructions fit the old base alone.
  expect(
    captionBase.length + JSON.stringify(compact).length + 10,
  ).toBeLessThanOrEqual(1135);
  const c = {
    home: {},
    away: {},
    favorite: "home",
    sport: "basketball",
    captionFacts: facts,
  };
  expect(captionInput(c)).not.toHaveProperty("gameContext");
  const at = Date.now();
  const game = {
    status: "live",
    date: new Date(at - 60000).toISOString(),
    capturedAt: new Date(at).toISOString(),
    score: { home: 30, away: 25 },
  };
  expect(
    captionInput({ ...c, gameContext: scoreContext(game, at) }).gameContext
      ?.facts,
  ).toEqual(compact);
  expect(
    captionInput({
      ...c,
      gameContext: scoreContext(
        { ...game, capturedAt: new Date(at - 31000).toISOString() },
        at,
      ),
    }),
  ).not.toHaveProperty("gameContext");
});

it("normalizes captured ESPN pregame, baseball pitching/batting, and soccer roster schemas", async () => {
  const { default: fixtures } =
    await import("./fixtures/espn-caption-summaries.json");
  const { normalize } = await import("../worker/src/providers/espn");
  const { leagueById } = await import("../packages/contracts/src/leagues");
  const games = fixtures.map((f) =>
    normalize(f.summary.header, leagueById(f.league), f.summary),
  );
  expect(games[0].captionFacts?.players.map((p) => p.name)).toContain("Bo Nix");
  const baseball = games[1].captionFacts!.players;
  expect(baseball.find((p) => p.name === "Blake Snell")?.detail).toBe(
    "game pitching strikeouts: 9",
  );
  expect(
    baseball.some(
      (p) => p.name === "Jackson Chourio" && p.detail === "game homeRuns: 1",
    ),
  ).toBe(true);
  expect(games[2].captionFacts?.players).toContainEqual({
    side: "home",
    name: "Jefferson Lerma",
    detail: "game Total Goals: 1",
  });
});
