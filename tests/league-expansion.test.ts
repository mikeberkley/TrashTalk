import { afterEach, describe, expect, it, vi } from "vitest";
import { leagueById } from "../packages/contracts/src/leagues";
import {
  catalogIdentity,
  catalogTeamDetail,
  collegeTeamsFromStandings,
  espn,
  getCatalogTeams,
  normalize,
  participant,
  scoreboardUrl,
  teamSeasonGames,
} from "../worker/src/providers/espn";
import { featuredCandidate } from "../worker/src/providers/featured-games";

afterEach(() => vi.restoreAllMocks());
const standings = () => ({
  id: "80",
  season: { year: 2026 },
  children: [
    {
      id: "8",
      name: "Southeastern Conference",
      abbreviation: "SEC",
      standings: {
        entries: [
          {
            team: {
              id: "333",
              displayName: "Alabama Crimson Tide",
              name: "Crimson Tide",
              abbreviation: "ALA",
            },
          },
        ],
      },
    },
    {
      id: "5",
      name: "Big Ten Conference",
      abbreviation: "big10",
      standings: {
        entries: [
          {
            team: {
              id: "194",
              displayName: "Ohio State Buckeyes",
              name: "Buckeyes",
              abbreviation: "OSU",
            },
          },
        ],
      },
    },
  ],
});

describe("expanded league catalogs", () => {
  it("retries a transient ESPN schedule failure once and still rejects a sustained failure", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(Response.json({ events: [] }));
    await expect(
      teamSeasonGames(leagueById("ncaaf"), "194", 2026),
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(
      teamSeasonGames(leagueById("ncaaf"), "194", 2026),
    ).rejects.toThrow("503");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("isolates WNBA and college numeric IDs while preserving existing pro and soccer identities", () => {
    const team = { id: "1", displayName: "Example" };
    expect(participant(team, leagueById("nfl")).id).toBe("espn:football:1");
    expect(participant(team, leagueById("nba")).id).toBe("espn:basketball:1");
    expect(participant(team, leagueById("wnba")).id).toBe("espn:wnba:1");
    expect(participant(team, leagueById("ncaaf")).id).toBe(
      "espn:college-football:1",
    );
    expect(participant(team, leagueById("epl")).id).toBe(
      participant(team, leagueById("ucl")).id,
    );
  });
  it("derives searchable conference metadata from the FBS standings and rejects malformed replacements", () => {
    const teams = collegeTeamsFromStandings(standings());
    expect(teams).toHaveLength(2);
    const identity = catalogIdentity(teams[0], leagueById("ncaaf"));
    expect(identity).toMatchObject({
      subdivision: "FBS",
      providerLeague: "college-football",
      catalogSeason: 2026,
      conference: { id: "8", name: "Southeastern Conference" },
    });
    expect(identity.aliases).toContain("SEC");
    for (const data of [
      {},
      { ...standings(), id: "81" },
      { ...standings(), children: [] },
      { ...standings(), children: [{ id: "8", name: "SEC" }] },
    ])
      expect(() => collegeTeamsFromStandings(data)).toThrow();
    const duplicate = standings();
    duplicate.children.push(duplicate.children[0]);
    expect(() => collegeTeamsFromStandings(duplicate)).toThrow("duplicate");
  });
  it("uses the FBS scoreboard group so unranked games are included", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ events: [] }));
    await espn.listGames("ncaaf", "2026-10-10");
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get("groups")).toBe("80");
    expect(url.searchParams.get("dates")).toBe("20261010");
    expect(
      new URL(scoreboardUrl(leagueById("wnba"))).searchParams.has("groups"),
    ).toBe(false);
  });
  it("preloads out-of-conference opponents without making them FBS members and deduplicates cross-conference games", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-13T12:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/standings?"))
        return Response.json(standings());
      return Response.json({
        events: ["194", "1000", "-2"].map((id) => ({
          id,
          date: "2026-10-17T12:00:00Z",
          competitions: [
            {
              status: { type: { state: "pre", detail: "Scheduled" } },
              competitors: [
                {
                  homeAway: "home",
                  team: { id: "333", displayName: "Alabama Crimson Tide" },
                },
                { homeAway: "away", team: { id, displayName: "Opponent" } },
              ],
            },
          ],
        })),
      });
    });
    const teams = await getCatalogTeams("ncaaf");
    expect(teams).toHaveLength(3);
    expect(teams.filter((t) => !t.catalogOpponent)).toHaveLength(2);
    expect(teams.find((t) => t.id === "1000")).toMatchObject({
      catalogOpponent: true,
      catalogSeason: 2026,
    });
  });
  it("fills missing college colors only from the matching university and retains source provenance", async () => {
    const seed = { id: "2771", displayName: "Merrimack Warriors" };
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ team: { ...seed, color: "000000" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          team: { ...seed, color: "2f4f93", alternateColor: "e8c535" },
        }),
      );
    const team = await catalogTeamDetail(seed, leagueById("ncaaf"));
    expect(team).toMatchObject({ color: "2f4f93", alternateColor: "e8c535" });
    expect(team.paletteSource).toContain("mens-college-basketball/teams/2771");
    fetcher
      .mockResolvedValueOnce(
        Response.json({ team: { ...seed, color: "000000" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          team: {
            id: "9",
            displayName: "Other",
            color: "ffffff",
            alternateColor: "000000",
          },
        }),
      );
    expect(
      (await catalogTeamDetail(seed, leagueById("ncaaf"))).alternateColor,
    ).toBeUndefined();
  });
  it("normalizes WNBA identities and scores featured progress using ten-minute quarters", () => {
    const event = {
      id: "123",
      competitions: [
        {
          status: {
            period: 1,
            displayClock: "10:00",
            type: { state: "in", detail: "In Progress" },
          },
          competitors: [
            {
              homeAway: "home",
              score: "0",
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
    const league = leagueById("wnba");
    expect(normalize(event, league)).toMatchObject({
      id: "wnba:123",
      home: { id: "espn:wnba:1" },
      score: { home: 0, away: 0 },
    });
    expect(featuredCandidate(event, league)?.featuredScore).toBe(0);
    event.competitions[0].status.displayClock = "5:00";
    expect(featuredCandidate(event, league)?.featuredScore).toBe(11.25);
  });
});
