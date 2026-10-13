const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;
const SCORE_MAX_AGE_MS = 30 * 1000;
/** Only a fresh ESPN response may supply game status or factual caption context. */
export function scoreContext(game: any, at = Date.now()) {
  if (!game) return undefined;
  const captured = Date.parse(game.capturedAt);
  if (
    !Number.isFinite(captured) ||
    captured > at + 5000 ||
    at - captured > SCORE_MAX_AGE_MS
  )
    return undefined;
  const start = Date.parse(game.date);
  if (game.status === "scheduled" && Number.isFinite(start) && start > at)
    return { status: "upcoming" };
  const score = game.score;
  if (
    ![score?.home, score?.away].every(
      (s) => typeof s === "number" && Number.isFinite(s) && s >= 0,
    )
  )
    return undefined;
  const final = game.status === "final";
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
/** Qualitative facts for caption writing; raw scores remain in stored game context. */
export function captionSituation(context: any) {
  const g = context.gameContext;
  if (!g) return undefined;
  if (g.status === "upcoming") return { status: "upcoming" };
  if (!["live", "final"].includes(g.status)) return undefined;
  const favorite = context.favorite;
  if (!["home", "away"].includes(favorite)) return undefined;
  const opponent = favorite === "home" ? "away" : "home";
  if (
    ![g.score?.[favorite], g.score?.[opponent]].every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
    )
  )
    return undefined;
  let difference = g.score[favorite] - g.score[opponent];
  const shootout =
    g.status === "final" &&
    difference === 0 &&
    context.sport === "soccer" &&
    [g.penalties?.[favorite], g.penalties?.[opponent]].every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
    ) &&
    g.penalties[favorite] !== g.penalties[opponent];
  if (shootout) difference = g.penalties[favorite] - g.penalties[opponent];
  const close =
    (
      {
        football: 8,
        basketball: 5,
        soccer: 1,
        baseball: 1,
        hockey: 1,
      } as Record<string, number>
    )[context.sport] || 1;
  const final = g.status === "final";
  return {
    status: g.status,
    outcome:
      difference === 0
        ? final
          ? "draw"
          : "tied"
        : difference > 0
          ? final
            ? "won"
            : "leading"
          : final
            ? "lost"
            : "trailing",
    ...(difference !== 0
      ? {
          margin: shootout
            ? "penalty shootout"
            : Math.abs(difference) <= close
              ? "narrow"
              : "clear",
        }
      : {}),
    ...(!final
      ? { period: g.period, clock: g.clock, phase: g.periodDisplay }
      : {}),
  };
}
/** Allowlist: never pass a feed dump, backstory, plays, stats, or cached research. */
export function captionInput(context: any) {
  const team = (t: any) => ({
    name: t.name,
    displayName: t.displayName,
    city: t.city,
    abbr: t.abbr,
  });
  const situation = captionSituation(context);
  return {
    league: context.league,
    leagueLabel: context.leagueLabel,
    sport: context.sport,
    favorite: context.favorite,
    away: team(context.away),
    home: team(context.home),
    ...(situation ? { gameContext: situation } : {}),
  };
}
