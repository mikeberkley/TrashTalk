/** Bounded facts from the same ESPN summary request; never fetch player profiles. */
export interface CaptionFacts {
  players: { side: string; name: string; detail: string }[];
  teams: string[];
  moments: string[];
}
const list = (value: any): any[] => (Array.isArray(value) ? value : []);
const text = (value: any, max = 120) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const metrics: Record<string, string[]> = {
  football: [
    "passingYards",
    "rushingYards",
    "receivingYards",
    "totalTackles",
    "sacks",
  ],
  basketball: ["points", "rebounds", "assists"],
  baseball: ["homeRuns", "RBIs", "hits", "strikeouts"],
  hockey: ["goals", "assists", "saves"],
  soccer: ["totalGoals", "goals", "goalAssists", "assists", "saves"],
};
export function extractCaptionFacts(
  summary: any,
  sport: string,
  status: string,
): CaptionFacts {
  const facts: CaptionFacts = { players: [], teams: [], moments: [] };
  const competitors = list(summary?.header?.competitions?.[0]?.competitors);
  const sideOf = (id: any) =>
    competitors.find((c) => String(c.team?.id) === String(id))?.homeAway;
  const upcoming = status === "scheduled";
  if (!["scheduled", "live", "final"].includes(status)) return facts;
  const add = (side: string, athlete: any, detail: string) => {
    const name = text(athlete?.displayName || athlete?.fullName, 60);
    if (!["home", "away"].includes(side) || !name || !detail) return;
    if (facts.players.some((p) => p.side === side && p.name === name)) return;
    if (facts.players.filter((p) => p.side === side).length >= 3) return;
    facts.players.push({ side, name, detail: text(detail, 100) });
  };
  // Game box scores establish actual participation and stat scope. Never use season
  // averages, DNP rows or pre-game leaders as evidence of a game performance.
  if (!upcoming)
    for (const group of list(summary?.boxscore?.players)) {
      const side = sideOf(group.team?.id);
      const candidates: {
        athlete: any;
        detail: string;
        weight: number;
        category: string;
      }[] = [];
      for (const category of list(group.statistics)) {
        const keys = list(category.keys);
        const selectedMetrics =
          sport === "baseball" && category.type === "pitching"
            ? ["strikeouts"]
            : metrics[sport] || [];
        for (const row of list(category.athletes)) {
          if (row.didNotPlay === true) continue;
          const stats = list(row.stats);
          for (const [priority, key] of selectedMetrics.entries()) {
            const index = keys.indexOf(key);
            const value = stats[index];
            if (
              index < 0 ||
              !/^\d+(\.\d+)?$/.test(String(value)) ||
              Number(value) <= 0
            )
              continue;
            candidates.push({
              athlete: row.athlete,
              category: category.type || category.name || "",
              detail: `game ${sport === "baseball" && category.type === "pitching" ? "pitching " : ""}${key}: ${value}`,
              weight: (10 - priority) * 10000 + Number(value),
            });
            break;
          }
        }
      }
      candidates.sort((a, b) => b.weight - a.weight);
      if (sport === "baseball") {
        for (const category of ["batting", "pitching"]) {
          const best = candidates.find((c) => c.category === category);
          if (best) add(side, best.athlete, best.detail);
        }
      }
      for (const c of candidates) add(side, c.athlete, c.detail);
    }
  // Soccer exposes individual match statistics in rosters rather than boxscore.players.
  if (!upcoming && sport === "soccer")
    for (const group of list(summary?.rosters)) {
      const candidates = list(group.roster)
        .flatMap((row) => {
          if (row.didNotPlay === true) return [];
          const stats = list(row.stats);
          const stat = ["totalGoals", "goalAssists", "saves", "shotsOnTarget"]
            .map((key) =>
              stats.find((s) => s.name === key && Number(s.value) > 0),
            )
            .find(Boolean);
          return stat
            ? [
                {
                  athlete: row.athlete,
                  stat,
                  weight:
                    (
                      {
                        totalGoals: 400,
                        goalAssists: 300,
                        saves: 200,
                        shotsOnTarget: 100,
                      } as Record<string, number>
                    )[stat.name] + Number(stat.value),
                },
              ]
            : [];
        })
        .sort((a, b) => b.weight - a.weight);
      for (const row of candidates)
        add(
          sideOf(group.team?.id),
          row.athlete,
          `game ${text(row.stat.displayName || row.stat.name, 30)}: ${text(row.stat.displayValue, 12) || row.stat.value}`,
        );
    }
  // Probables are explicitly unconfirmed, and only used before the game.
  if (upcoming)
    for (const c of competitors)
      for (const p of list(c.probables))
        add(c.homeAway, p.athlete, text(p.displayName || p.name, 70));
  for (const group of list(summary?.leaders)) {
    const side = sideOf(group.team?.id);
    for (const category of list(group.leaders)) {
      for (const entry of list(category.leaders).slice(0, 1)) {
        // In live/final summaries leader scope varies by sport: names/roles only
        // unless game performance was independently established by boxscore above.
        add(
          side,
          entry.athlete,
          upcoming
            ? `pre-game ${text(category.displayName || category.name, 32)} leader: ${text(entry.displayValue, 55)}`
            : `ESPN featured ${text(category.displayName || category.name, 32)} leader; game participation unconfirmed`,
        );
      }
    }
  }
  if (upcoming)
    for (const group of list(summary?.injuries)) {
      for (const injury of list(group.injuries)) {
        const player = facts.players.find(
          (p) =>
            p.side === sideOf(group.team?.id) &&
            p.name ===
              text(injury.athlete?.displayName || injury.athlete?.fullName, 60),
        );
        if (player && text(injury.status, 24))
          player.detail = `${text(injury.status, 24)}; ${player.detail}`;
      }
    }
  for (const c of competitors) {
    if (!["home", "away"].includes(c.homeAway)) continue;
    const record = list(c.record || c.records).find((r) => r.type === "total");
    if (record)
      facts.teams.push(
        `${c.homeAway} record ${text(record.displayValue || record.summary, 30)}`,
      );
    if (upcoming && /^[WDL]{1,5}$/.test(c.form || ""))
      facts.teams.push(`${c.homeAway} recent form ${c.form}`);
    const group = list(summary?.boxscore?.teams).find(
      (g) => String(g.team?.id) === String(c.team?.id),
    );
    const stats = list(group?.statistics).filter((s) => s.displayValue != null);
    const useful =
      stats.find((s) =>
        /turnovers|totalYards|shotsOnTarget|shotsTotal|errors|totalPointsPerGame|totalGoals/i.test(
          s.name || "",
        ),
      ) || stats[0];
    if (useful)
      facts.teams.push(
        `${c.homeAway} ${upcoming ? "pre-game" : "game"} ${text(useful.label || useful.name, 35)}: ${text(useful.displayValue, 20)}`,
      );
  }
  if (!upcoming) {
    // Scoring lists are authoritative highlights, not the last item in an
    // arbitrarily ordered play feed. Do not call these the latest/decisive play.
    const plays = [
      ...list(summary?.scoringPlays),
      ...list(summary?.plays),
      ...list(summary?.commentary),
    ];
    for (const p of plays) {
      const description = text(p.text || p.play?.text, 2000);
      if (description.length > 180) continue;
      if (
        p.hidden ||
        p.noPlay ||
        /no play|nullified|overturned|reversed|extra point|two.point conversion/i.test(
          description,
        )
      )
        continue;
      if (
        !p.scoringPlay &&
        !/touchdown|intercept|fumble|home run|grand slam|\bgoal\b|red card|buzzer/i.test(
          description,
        )
      )
        continue;
      if (description && !facts.moments.includes(description))
        facts.moments.push(description);
    }
    facts.moments = facts.moments.slice(-3);
  }
  return facts;
}
