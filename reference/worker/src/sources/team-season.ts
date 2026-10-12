import { z } from 'zod';
import type {
  DivisionStandings,
  TeamSchedule,
  TeamSeasonStats,
} from '../../../packages/contracts/src/team-season';
const team = z.object({
  id: z.string(),
  displayName: z.string(),
  abbreviation: z.string(),
  logos: z.array(z.object({ href: z.string() })).optional(),
});
const entry = z.object({
  team,
  stats: z.array(
    z.object({
      name: z.string(),
      displayValue: z.string().optional(),
      summary: z.string().optional(),
    }),
  ),
});
type Group = {
  name: string;
  standings?: { entries: z.infer<typeof entry>[] };
  children?: Group[];
};
const group: z.ZodType<Group> = z.lazy(() =>
  z.object({
    name: z.string(),
    standings: z.object({ entries: z.array(entry) }).optional(),
    children: z.array(group).optional(),
  }),
);
const event = z.object({
  id: z.string(),
  date: z.string(),
  week: z.object({ number: z.number() }),
  timeValid: z.boolean().optional(),
  competitions: z.array(
    z.object({
      timeValid: z.boolean().optional(),
      status: z.object({
        type: z.object({
          description: z.string(),
          state: z.string(),
          completed: z.boolean().optional(),
        }),
      }),
      competitors: z.array(
        z.object({
          team,
          homeAway: z.string(),
          score: z.object({ value: z.number() }).optional(),
        }),
      ),
    }),
  ),
});
async function get(url: string) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    cf: { cacheTtl: 120, cacheEverything: true },
  });
  if (!r.ok) throw Error('ESPN unavailable');
  return r.json();
}
export function parseStandings(
  data: unknown,
  id: string,
  season: number,
): DivisionStandings {
  const root = group.parse(data);
  function find(g: Group): Group | undefined {
    if (
      g.standings?.entries.length === 4 &&
      g.standings.entries.some((e) => e.team.id === id)
    )
      return g;
    for (const child of g.children ?? []) {
      const match = find(child);
      if (match) return match;
    }
  }
  const division = find(root);
  if (!division?.standings) throw Error('Division unavailable');
  return {
    season,
    division: division.name,
    checkedAt: new Date().toISOString(),
    teams: division.standings.entries.map((e) => {
      const stat = (name: string) => {
        const s = e.stats.find((s) => s.name === name);
        return s?.displayValue ?? s?.summary ?? '—';
      };
      return {
        id: e.team.id,
        name: e.team.displayName,
        abbr: e.team.abbreviation,
        logo: e.team.logos?.[0]?.href ?? '',
        wins: stat('wins'),
        losses: stat('losses'),
        ties: stat('ties'),
        pct: stat('winPercent'),
        divisionRecord: stat('divisionRecord'),
        streak: stat('streak'),
      };
    }),
  };
}
export function parseSchedule(
  data: unknown,
  id: string,
  season: number,
): TeamSchedule {
  const parsed = z.object({ events: z.array(event) }).parse(data);
  return {
    season,
    checkedAt: new Date().toISOString(),
    games: parsed.events
      .map((e): TeamSchedule['games'][number] => {
        const c = e.competitions[0],
          own = c?.competitors.find((p) => p.team.id === id),
          opp = c?.competitors.find((p) => p.team.id !== id);
        if (!c || !own || !opp) throw Error('Schedule incomplete');
        const completed = c.status.type.completed === true;
        const a = own.score?.value,
          b = opp.score?.value;
        return {
          id: e.id,
          week: e.week.number,
          date: e.date,
          timeValid: e.timeValid !== false && c.timeValid !== false,
          opponent: opp.team.displayName,
          logo: opp.team.logos?.[0]?.href ?? '',
          home: own.homeAway === 'home',
          status: c.status.type.description,
          completed,
          result:
            completed && a !== undefined && b !== undefined
              ? a > b
                ? 'W'
                : a < b
                  ? 'L'
                  : 'T'
              : null,
          score:
            completed && a !== undefined && b !== undefined
              ? `${a}–${b}`
              : null,
        };
      })
      .sort((a, b) => a.week - b.week || a.date.localeCompare(b.date)),
  };
}
export async function divisionStandings(id: string, season: number) {
  return parseStandings(
    await get(
      `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}&type=0&level=3`,
    ),
    id,
    season,
  );
}
export async function teamSchedule(id: string, season: number) {
  return parseSchedule(
    await get(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/schedule?season=${season}&seasontype=2`,
    ),
    id,
    season,
  );
}

export function parseTeamStats(data: unknown, season: number): TeamSeasonStats {
  const parsed = z
    .object({
      results: z.object({
        stats: z.object({
          categories: z.array(
            z.object({
              name: z.string(),
              stats: z.array(
                z.object({ name: z.string(), value: z.number().optional() }),
              ),
            }),
          ),
        }),
      }),
    })
    .parse(data);
  const stat = (category: string, name: string) =>
    parsed.results.stats.categories
      .find((c) => c.name === category)
      ?.stats.find((s) => s.name === name)?.value ?? null;
  const games = stat('passing', 'teamGamesPlayed');
  const firstDowns = stat('miscellaneous', 'firstDowns');
  return {
    season,
    checkedAt: new Date().toISOString(),
    pointsPerGame: stat('passing', 'totalPointsPerGame'),
    yardsPerGame: stat('passing', 'yardsPerGame'),
    passingPerGame: stat('passing', 'netPassingYardsPerGame'),
    rushingPerGame: stat('rushing', 'rushingYardsPerGame'),
    firstDownsPerGame: games && firstDowns !== null ? firstDowns / games : null,
  };
}
export async function teamStats(id: string, season: number) {
  return parseTeamStats(
    await get(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/statistics?season=${season}&seasontype=2`,
    ),
    season,
  );
}
