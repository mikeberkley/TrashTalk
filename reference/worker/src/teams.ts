import type { Snapshot } from '../../packages/contracts/src';
import catalog from '../../packages/contracts/src/nfl-teams.json';
import {
  officialYouTubeChannel,
  type OfficialYouTubeChannel,
} from './sources/youtube';
export type TeamRecord = (typeof catalog)[number] & {
  youtubeChannel?: OfficialYouTubeChannel;
};
let cached:
  | { at: number; database: D1Database | undefined; teams: TeamRecord[] }
  | undefined;
export async function teamDirectory(db?: D1Database): Promise<TeamRecord[]> {
  if (cached && cached.database === db && Date.now() - cached.at < 60000)
    return cached.teams;
  let teams = catalog;
  if (db) {
    const result = await db
      .prepare(
        'SELECT id,league,abbreviation AS abbr,display_name AS displayName,city,name,primary_color AS primaryColor,secondary_color AS secondaryColor,logo_url AS logo,source_url AS sourceUrl,updated_at AS updatedAt FROM teams ORDER BY display_name',
      )
      .all<TeamRecord>();
    if (result.results.length) teams = result.results;
  }
  const enriched = teams.map((team) => ({
    ...team,
    youtubeChannel: officialYouTubeChannel(team.abbr),
  }));
  cached = { at: Date.now(), database: db, teams: enriched };
  return enriched;
}
export async function applyTeamDirectory(s: Snapshot, db?: D1Database) {
  const teams = await teamDirectory(db);
  for (const side of ['home', 'away'] as const) {
    const t = teams.find((t) => t.abbr === s[side].abbr);
    if (t)
      s[side] = {
        ...s[side],
        color: t.primaryColor,
        secondaryColor: t.secondaryColor,
        logo: t.logo,
        youtubeChannel: t.youtubeChannel,
      };
  }
}
