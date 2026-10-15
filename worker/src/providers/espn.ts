import { extractCaptionFacts } from "./caption-facts";
import {
  leagueById,
  type Game,
  type League,
  type Participant,
  type SportsProvider,
} from "../../../packages/contracts/src/leagues";
import { selectTeamGames } from "./team-games";
export const base = "https://site.api.espn.com/apis/site/v2/sports";
export async function getJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw Error(`Sports feed unavailable (${r.status})`);
  return r.json() as Promise<any>;
}
export function participant(t: any, l: League): Participant {
  return {
    id: `espn:${l.teamNamespace}:${t.id}`,
    name: t.name || t.shortDisplayName || t.displayName,
    city: t.location || "",
    displayName: t.displayName,
    abbr: t.abbreviation,
  };
}
const score = (c: any) =>
  c.score == null || c.score === "" ? null : Number(c.score?.value ?? c.score);
export function periodDisplay(
  sport: string,
  p: number,
  clock: string,
  detail: string,
) {
  if (sport === "baseball") return detail;
  if (sport === "soccer")
    return p === 5
      ? "Penalties"
      : p > 2
        ? `Extra time · ${clock}`
        : `${p === 1 ? "1st half" : "2nd half"} · ${clock}`;
  const regular = sport === "hockey" ? 3 : 4;
  return `${p > regular ? (sport === "hockey" && p === 5 ? "Shootout" : "OT") : `${sport === "hockey" ? "P" : "Q"}${p}`} · ${clock}`;
}
export function validMoment(p: any) {
  return (
    !p.hidden &&
    !p.noPlay &&
    !/no play|nullified|overturned|reversed|extra point|two.point conversion/i.test(
      p.text || "",
    )
  );
}
export function rankMoments(plays: any[], sport: string) {
  const patterns: Record<string, RegExp> = {
    football: /touchdown|intercept|fumble|sack|field goal/i,
    basketball: /three point|dunk|run|wins|buzzer/i,
    baseball: /home run|scores|scored|grand slam/i,
    hockey: /goal|shootout/i,
    soccer: /goal|penalty|red card/i,
  };
  return plays
    .filter(validMoment)
    .map((p, i) => ({ ...p, _index: i }))
    .sort(
      (a, b) =>
        Number(patterns[sport]?.test(b.text || "")) -
          Number(patterns[sport]?.test(a.text || "")) || b._index - a._index,
    );
}
export function normalize(event: any, l: League, summary?: any): Game {
  const c = event.competitions?.[0];
  if (!c || c.competitors?.length !== 2)
    throw Error("Unsupported participant count");
  const h = c.competitors.find((x: any) => x.homeAway === "home"),
    a = c.competitors.find((x: any) => x.homeAway === "away");
  if (!h || !a) throw Error("Missing participants");
  const st = c.status || event.status,
    detail = st?.type?.detail || st?.type?.description || "Unknown";
  const status =
    ![h.team?.id, a.team?.id].every(
      (id) => /^\d+$/.test(String(id)) && Number(id) > 0,
    ) || /postpon|cancel|suspend|delay|unknown/i.test(detail)
      ? "unavailable"
      : st?.type?.completed
        ? "final"
        : st?.type?.state === "in"
          ? "live"
          : st?.type?.state === "pre"
            ? "scheduled"
            : "unavailable";
  const plays =
    summary?.plays || summary?.commentary || summary?.scoringPlays || [];
  const moment = rankMoments(plays, l.sport)[0];
  const g: Game = {
    id: `${l.id}:${event.id}`,
    providerId: event.id,
    league: l.id,
    sport: l.sport,
    leagueLabel: l.label,
    date: event.date || c.date,
    status,
    statusText: detail,
    period: st?.period || 0,
    clock: st?.displayClock || "",
    periodDisplay: periodDisplay(
      l.sport,
      st?.period || 0,
      st?.displayClock || "",
      detail,
    ),
    neutral: !!c.neutralSite,
    home: participant(h.team, l),
    away: participant(a.team, l),
    score: {
      home: status === "scheduled" ? null : score(h),
      away: status === "scheduled" ? null : score(a),
    },
    penalties: {
      home: h.shootoutScore == null ? null : Number(h.shootoutScore),
      away: a.shootoutScore == null ? null : Number(a.shootoutScore),
    },
    capturedAt: new Date().toISOString(),
    source: `${base}/${l.sport}/${l.path}/summary?event=${event.id}`,
    recentMoment: moment
      ? {
          id: moment.id,
          text: moment.text,
          period: moment.period,
          clock: moment.clock,
        }
      : null,
    statistics: summary?.boxscore?.teams || [],
    captionFacts: extractCaptionFacts(summary, l.sport, status),
    revision: "",
  };
  g.revision = JSON.stringify([
    g.id,
    g.status,
    g.score,
    g.penalties,
    g.recentMoment,
    g.statistics,
  ]);
  return g;
}
export function scoreboardUrl(l: League, date?: string) {
  const params = new URLSearchParams({ limit: "1000" });
  if (date) params.set("dates", date.replaceAll("-", ""));
  if (l.scoreboardGroup) params.set("groups", l.scoreboardGroup);
  return `${base}/${l.sport}/${l.path}/scoreboard?${params}`;
}

export const collegeStandingsUrl =
  "https://site.web.api.espn.com/apis/v2/sports/football/college-football/standings?region=us&lang=en&contentorigin=espn&type=0&level=2";

export function collegeTeamsFromStandings(data: any) {
  if (
    String(data.id) !== "80" ||
    !Array.isArray(data.children) ||
    !data.children.length
  )
    throw Error("Missing FBS conference catalog");
  const teams = new Map<string, any>();
  for (const conference of data.children) {
    const entries = conference.standings?.entries;
    if (
      !conference.id ||
      !conference.name ||
      !Array.isArray(entries) ||
      !entries.length
    )
      throw Error("Incomplete FBS conference catalog");
    for (const { team } of entries) {
      if (!team?.id || !team.displayName || teams.has(team.id))
        throw Error("Invalid or duplicate FBS team");
      teams.set(team.id, {
        ...team,
        conference: {
          id: String(conference.id),
          name: conference.name,
          abbreviation: conference.abbreviation,
        },
        subdivision: "FBS",
        catalogSeason: data.season?.year ?? conference.standings.season,
      });
    }
  }
  return [...teams.values()];
}

// Persist the same discovery metadata during initial imports and daily refreshes.
export function catalogIdentity(team: any, l: League) {
  return {
    ...participant(team, l),
    providerId: String(team.id),
    providerLeague: l.path,
    sport: l.sport,
    aliases: [
      ...new Set(
        [
          team.shortDisplayName,
          team.slug,
          l.label,
          team.conference?.name,
          team.conference?.abbreviation,
        ].filter(Boolean),
      ),
    ],
    ...(team.conference ? { conference: team.conference } : {}),
    ...(team.subdivision ? { subdivision: team.subdivision } : {}),
    ...(team.catalogSeason ? { catalogSeason: team.catalogSeason } : {}),
    catalogOpponent: !!team.catalogOpponent,
  };
}

export async function catalogTeamDetail(seed: any, l: League) {
  const source = `${base}/${l.sport}/${l.path}/teams/${seed.id}`;
  const { team } = await getJson(source);
  if (String(team?.id) !== String(seed.id))
    throw Error("Team detail identity mismatch");
  const detail = { ...seed, ...team, paletteSource: source };
  // Use the same university's verified ESPN palette if its football feed omits colors.
  if (
    l.id === "ncaaf" &&
    ![detail.color, detail.alternateColor].every(
      (c) => typeof c === "string" && /^[a-f\d]{6}$/i.test(c),
    )
  ) {
    const fallback = `${base}/basketball/mens-college-basketball/teams/${seed.id}`;
    const { team: university } = await getJson(fallback);
    if (
      university?.id === team.id &&
      university.displayName === team.displayName &&
      [university.color, university.alternateColor].every(
        (c) => typeof c === "string" && /^[a-f\d]{6}$/i.test(c),
      )
    ) {
      detail.color = university.color;
      detail.alternateColor = university.alternateColor;
      detail.paletteSource = fallback;
    }
  }
  return detail;
}

export async function getCatalogTeams(id: string) {
  const teams = await espn.getTeams(id);
  if (id !== "ncaaf") return teams;
  const l = leagueById(id);
  const all = new Map(teams.map((team) => [String(team.id), team]));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < teams.length) {
        const team = teams[cursor++];
        const schedule = await getJson(
          `${base}/${l.sport}/${l.path}/teams/${team.id}/schedule?season=${team.catalogSeason}`,
        );
        if (!Array.isArray(schedule.events))
          throw Error("Missing college opponent schedule");
        const needed = selectTeamGames(
          schedule.events.map((e: any) => normalize(e, l)),
          participant(team, l).id,
        );
        for (const game of needed) {
          for (const opponent of [game.home, game.away]) {
            const providerId = opponent.id.split(":").pop()!;
            if (!all.has(providerId))
              all.set(providerId, {
                ...opponent,
                id: providerId,
                catalogOpponent: true,
                catalogSeason: team.catalogSeason,
              });
          }
        }
      }
    }),
  );
  return [...all.values()];
}
export async function teamSeasonGames(
  l: League,
  providerId: string,
  season: number,
): Promise<Game[]> {
  const url = `${base}/${l.sport}/${l.path}/teams/${providerId}/schedule?season=${season}`;
  const read = async () => {
    const data = await getJson(url);
    if (!Array.isArray(data.events)) throw Error("Schedule unavailable");
    return data.events.map((event: any) => normalize(event, l));
  };
  try {
    return await read();
  } catch {
    return read();
  }
}
export const espn: SportsProvider = {
  async listGames(id, date) {
    const l = leagueById(id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("Invalid date");
    const d = await getJson(scoreboardUrl(l, date));
    if (!Array.isArray(d.events)) throw Error("Malformed schedule");
    return d.events
      .map((e: any) => normalize(e, l))
      .sort(
        (a: Game, b: Game) =>
          ({ live: 0, scheduled: 1, final: 2, unavailable: 3 })[a.status] -
            { live: 0, scheduled: 1, final: 2, unavailable: 3 }[b.status] ||
          a.date.localeCompare(b.date),
      );
  },
  async getGame(id) {
    const [lid, eid] = id.split(":");
    if (!/^\d+$/.test(eid)) throw Error("Invalid event");
    const l = leagueById(lid),
      s = await getJson(`${base}/${l.sport}/${l.path}/summary?event=${eid}`);
    if (!s.header) throw Error("Missing game facts");
    return normalize(s.header, l, s);
  },
  async getTeams(id) {
    if (id === "ncaaf")
      return collegeTeamsFromStandings(await getJson(collegeStandingsUrl));
    const l = leagueById(id),
      d = await getJson(`${base}/${l.sport}/${l.path}/teams?limit=1000`);
    const t = d.sports?.[0]?.leagues?.[0]?.teams;
    if (!Array.isArray(t) || !t.length) throw Error("Missing team catalog");
    return t.map((x: any) => x.team);
  },
  async getRecentMoments(id) {
    return [(await this.getGame(id)).recentMoment].filter(Boolean);
  },
};
