import {
  leagueById,
  type Game,
  type League,
  type Participant,
  type SportsProvider,
} from "../../../packages/contracts/src/leagues";
export const base = "https://site.api.espn.com/apis/site/v2/sports";
export async function getJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw Error(`Sports feed unavailable (${r.status})`);
  return r.json() as Promise<any>;
}
export function participant(t: any, l: League): Participant {
  return {
    id: `espn:${l.sport}:${t.id}`,
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
  const status = /postpon|cancel|suspend|delay|unknown/i.test(detail)
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
export const espn: SportsProvider = {
  async listGames(id, date) {
    const l = leagueById(id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("Invalid date");
    const d = await getJson(
      `${base}/${l.sport}/${l.path}/scoreboard?dates=${date.replaceAll("-", "")}&limit=1000`,
    );
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
