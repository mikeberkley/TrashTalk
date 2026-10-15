export const leagues = [
  ["nfl", "NFL", "football", "nfl", "America/New_York"],
  ["nba", "NBA", "basketball", "nba", "America/New_York"],
  ["mlb", "MLB", "baseball", "mlb", "America/New_York"],
  ["nhl", "NHL", "hockey", "nhl", "America/New_York"],
  ["epl", "Premier League", "soccer", "eng.1", "Europe/London"],
  ["laliga", "La Liga", "soccer", "esp.1", "Europe/Madrid"],
  ["bundesliga", "Bundesliga", "soccer", "ger.1", "Europe/Berlin"],
  ["seriea", "Serie A", "soccer", "ita.1", "Europe/Rome"],
  ["ligue1", "Ligue 1", "soccer", "fra.1", "Europe/Paris"],
  ["mls", "MLS", "soccer", "usa.1", "America/New_York"],
  ["nwsl", "NWSL", "soccer", "usa.nwsl", "America/New_York"],
  ["ucl", "Champions League", "soccer", "uefa.champions", "Europe/London"],
  ["wnba", "WNBA", "basketball", "wnba", "America/New_York"],
  [
    "ncaaf",
    "College Football (FBS)",
    "football",
    "college-football",
    "America/New_York",
  ],
].map(([id, label, sport, path, timezone]) => ({
  id,
  label,
  sport,
  path,
  timezone,
  isWomensLeague: id === "wnba" || id === "nwsl",
  // Keep existing IDs stable while isolating ESPN's overlapping team numbers.
  teamNamespace: id === "wnba" || id === "ncaaf" ? path : sport,
  scoreboardGroup: id === "ncaaf" ? "80" : undefined,
  periodSeconds:
    sport === "football"
      ? 900
      : sport === "hockey"
        ? 1200
        : id === "wnba"
          ? 600
          : 720,
}));
export type League = (typeof leagues)[number];
export const leagueById = (id: string) => {
  const l = leagues.find((l) => l.id === id);
  if (!l) throw Error("Unknown league");
  return l;
};
export interface Game {
  id: string;
  providerId: string;
  league: string;
  sport: string;
  leagueLabel: string;
  date: string;
  status: "scheduled" | "live" | "final" | "unavailable";
  statusText: string;
  period: number;
  clock: string;
  periodDisplay: string;
  neutral: boolean;
  home: Participant;
  away: Participant;
  score: { home: number | null; away: number | null };
  penalties: { home: number | null; away: number | null };
  capturedAt: string;
  source: string;
  recentMoment: any;
  statistics: any[];
  revision: string;
}
export interface Participant {
  brandingUrl?: string;
  id: string;
  name: string;
  city: string;
  displayName: string;
  abbr: string;
}
export interface SportsProvider {
  listGames(league: string, date: string): Promise<Game[]>;
  getGame(id: string): Promise<Game>;
  getTeams(league: string): Promise<any[]>;
  getRecentMoments(id: string): Promise<any[]>;
}
