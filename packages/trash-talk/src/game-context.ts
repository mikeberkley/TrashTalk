const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;
const SCORE_MAX_AGE_MS = 30 * 1000;
/** Only a fresh ESPN scoreboard may supply factual caption context. */
export function scoreContext(game: any, at = Date.now()) {
  if (!game) return undefined;
  const captured = Date.parse(game.capturedAt);
  if (
    !Number.isFinite(captured) ||
    captured > at + 5000 ||
    at - captured > SCORE_MAX_AGE_MS
  )
    return undefined;
  const score = game.score;
  if (
    ![score?.home, score?.away].every(
      (s) => typeof s === "number" && Number.isFinite(s) && s >= 0,
    )
  )
    return undefined;
  const final = game.status === "final";
  const start = Date.parse(game.date);
  const live =
    game.status === "live" &&
    Number.isFinite(start) &&
    at >= start &&
    at < start + LIVE_WINDOW_MS;
  if (!final && !live) return undefined;
  const context: any = {
    status: final ? "final" : "live",
    score: { home: score.home, away: score.away },
    capturedAt: game.capturedAt,
  };
  if (live) {
    context.period = game.period;
    context.clock = game.clock;
    context.periodDisplay = game.periodDisplay;
  }
  if (
    game.sport === "soccer" &&
    [game.penalties?.home, game.penalties?.away].every(
      (s) => typeof s === "number" && Number.isFinite(s) && s >= 0,
    )
  )
    context.penalties = {
      home: game.penalties.home,
      away: game.penalties.away,
    };
  return context;
}
/** Allowlist: never pass a feed dump, backstory, plays, stats, or cached research. */
export function captionInput(context: any) {
  const team = (t: any) => ({
    name: t.name,
    displayName: t.displayName,
    city: t.city,
    abbr: t.abbr,
  });
  return {
    league: context.league,
    leagueLabel: context.leagueLabel,
    sport: context.sport,
    favorite: context.favorite,
    away: team(context.away),
    home: team(context.home),
    ...(context.gameContext ? { gameContext: context.gameContext } : {}),
  };
}
