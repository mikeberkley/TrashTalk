import type { Snapshot, Play } from '../../contracts/src';
import { importantPlay, type Side } from '../../fan/src';

const valid = (p: Play) =>
  !p.hidden &&
  !p.noPlay &&
  !/no play|play nullified|touchdown nullified|overturned|reversed/i.test(
    p.text,
  );
const conversion = (p: Play) =>
  /extra[ -]point|two[ -]point|2[ -](?:point|pt)|conversion/i.test(
    `${p.playType ?? ''} ${p.text}`,
  ) && !/touchdown/i.test(p.playType ?? p.text);
export function trashTalkContext(s: Snapshot, side: Side) {
  const plays = s.plays
    .filter(valid)
    .sort(
      (a, b) =>
        a.period - b.period ||
        b.clock.localeCompare(a.clock, undefined, { numeric: true }) ||
        a.sequence - b.sequence,
    );
  const major = plays.filter(
    (p) =>
      !conversion(p) &&
      (p.kind === 'score' ||
        p.turnover ||
        p.kind === 'turnover' ||
        p.sack ||
        /\bsacked\b/i.test(p.text)),
  );
  const moment =
    major.at(-1) ??
    plays.filter((p) => importantPlay(p) && !conversion(p)).at(-1);
  return {
    home: {
      name: s.home.name,
      city: s.home.city,
      abbr: s.home.abbr,
      color: s.home.color,
      logo: s.home.logo,
    },
    away: {
      name: s.away.name,
      city: s.away.city,
      abbr: s.away.abbr,
      color: s.away.color,
      logo: s.away.logo,
    },
    favorite: side,
    status: s.status,
    scheduledAt: s.scheduledAt,
    score:
      s.status === 'scheduled'
        ? null
        : { home: s.homeScore, away: s.awayScore },
    period: s.status === 'scheduled' ? 0 : s.period,
    clock: s.status === 'live' ? s.clock : null,
    briefing: s.status === 'scheduled' ? s.storylines : undefined,
    moment:
      s.status === 'live' && moment
        ? {
            id: moment.id,
            revision: moment.revision,
            text: moment.text.slice(0, 1800),
            team: moment.team,
            scoringTeam: moment.scoringTeam,
            period: moment.period,
            clock: moment.clock,
            homeScore: moment.homeScore,
            awayScore: moment.awayScore,
          }
        : undefined,
    stats:
      s.status === 'final' && s.statsAvailable !== false ? s.stats : undefined,
  };
}
export function trashTalkKey(s: Snapshot, side: Side) {
  const c = trashTalkContext(s, side);
  // Clock ticks alone never trigger another paid image.
  return JSON.stringify([
    'trash-talk-v2',
    s.id,
    s.generation,
    side,
    c.status,
    c.score,
    c.briefing,
    c.moment,
    c.stats,
    s.status === 'live' ? s.period : 0,
  ]);
}
export type TrashTalkResult = {
  text: string;
  gameTitle?: string;
  url: string;
  label: string;
  generatedAt: string;
  contextKey: string;
};
export type TrashTalkImage = Omit<TrashTalkResult, 'contextKey'>;
export type TrashTalkState = {
  nextAvailableAt?: number;
  images?: TrashTalkImage[];
  status: 'idle' | 'pending' | 'complete' | 'failed';
  result?: TrashTalkResult;
  error?: string;
};
