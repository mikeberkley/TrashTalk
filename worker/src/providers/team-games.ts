import type { Game } from "../../../packages/contracts/src/leagues";

export function availableTeamGames(
  results: PromiseSettledResult<Game[]>[],
  teamId: string,
) {
  const games = selectTeamGames(
    results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    teamId,
  );
  if (!games.length && results.some((r) => r.status === "rejected"))
    throw Error("Schedule unavailable. Please try again.");
  return games;
}

export function selectTeamGames(
  games: Game[],
  teamId: string,
  at = Date.now(),
) {
  const unique = [
    ...new Map(
      games
        .filter(
          (g) =>
            [g.away.id, g.home.id].includes(teamId) &&
            Number.isFinite(Date.parse(g.date)),
        )
        .map((g) => [g.id, g]),
    ).values(),
  ];
  const latest = unique
    .filter((g) => g.status === "final" && Date.parse(g.date) <= at)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const upcoming = unique
    .filter(
      (g) =>
        g.status === "live" ||
        (g.status === "scheduled" && Date.parse(g.date) >= at),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  return latest ? [latest, ...upcoming] : upcoming;
}
