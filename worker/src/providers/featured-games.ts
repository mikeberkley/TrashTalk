import { leagues, type League } from "../../../packages/contracts/src/leagues";
import { type Env, sql, now } from "../env";
import { getJson, normalize, scoreboardUrl } from "./espn";

const clamp = (n: number) => Math.max(0, Math.min(1, n));
// Scores are comparable across sports: 70% late-and-close, 20% progress, 10% stakes.
export function featuredCandidate(event: any, league: League) {
  const game = normalize(event, league);
  if (
    game.status !== "live" ||
    !Number.isFinite(game.score.home) ||
    !Number.isFinite(game.score.away)
  )
    return null;
  const c = event.competitions[0],
    st = c.status || event.status;
  const period = game.period;
  let progress = 0;
  const clock = /^(\d+):(\d{2})$/.exec(game.clock);
  const remaining = Number.isFinite(st.clock)
    ? st.clock
    : clock
      ? Number(clock[1]) * 60 + Number(clock[2])
      : null;
  if (league.sport === "baseball") {
    const bottom = /bottom|bot|end/i.test(game.statusText);
    progress = clamp((period - 1 + (bottom ? 0.5 : 0)) / 9);
  } else if (league.sport === "soccer") {
    const minutes = Number.parseFloat(game.clock);
    progress =
      period > 2
        ? 1
        : Number.isFinite(minutes)
          ? clamp(minutes / 90)
          : clamp((period - 1) / 2);
  } else {
    const periods = league.sport === "hockey" ? 3 : 4;
    const seconds = league.periodSeconds;
    progress =
      period > periods
        ? 1
        : clamp(
            (period -
              1 +
              (remaining === null ? 0 : 1 - clamp(remaining / seconds))) /
              periods,
          );
  }
  const gap = Math.abs(game.score.home! - game.score.away!);
  const unit =
    { football: 8, basketball: 6, baseball: 2, hockey: 1, soccer: 1 }[
      league.sport
    ] || 1;
  const closeness = 1 / (1 + gap / unit);
  // Use only explicit ESPN metadata; no inferred rivalries or invented playoff stakes.
  const notes = (c.notes || []).map((n: any) => n.headline || "").join(" ");
  const round = [
    notes,
    c.type?.text,
    c.type?.name,
    c.series?.title,
    c.series?.summary,
  ]
    .filter(Boolean)
    .join(" ");
  const postseason = Number(event.season?.type) === 3;
  const knockout =
    /final|playoff|knockout|round of|wild card|division series|championship/i.test(
      round,
    ) || ["FINAL", "SEMI", "QF"].includes(c.type?.abbreviation);
  const championship =
    /world series|super bowl|stanley cup final|nba finals|championship game/i.test(
      round,
    ) || c.type?.abbreviation === "FINAL";
  const importance = championship ? 1 : postseason || knockout ? 0.7 : 0;
  const reason = championship
    ? "Championship"
    : postseason || knockout
      ? "Playoff / knockout"
      : gap === 0
        ? "Tied game"
        : "Live matchup";
  return {
    ...game,
    featuredScore: 70 * progress * closeness + 20 * progress + 10 * importance,
    featuredReason: reason,
  };
}
export function rankFeatured(games: ReturnType<typeof featuredCandidate>[]) {
  return games
    .filter((g): g is NonNullable<typeof g> => !!g)
    .sort(
      (a, b) => b.featuredScore - a.featuredScore || a.id.localeCompare(b.id),
    )
    .slice(0, 3);
}
export async function cachedFeaturedGames(env: Env) {
  const key = "featured-live-v1";
  const row = await sql(
    env,
    "SELECT value FROM cache WHERE key=? AND expires>?",
    key,
    now(),
  ).first<{ value: string }>();
  if (row) return JSON.parse(row.value);
  const enabled = await sql(env, "SELECT id FROM leagues WHERE enabled=1").all<{
    id: string;
  }>();
  const results = await Promise.allSettled(
    leagues
      .filter((l) => enabled.results.some((e) => e.id === l.id))
      .map(async (l) => {
        // ESPN's current scoreboard avoids dropping games that cross midnight.
        const d = await getJson(scoreboardUrl(l));
        if (!Array.isArray(d.events)) throw Error("Malformed scoreboard");
        return d.events.flatMap((e: any) => {
          try {
            const candidate = featuredCandidate(e, l);
            return candidate ? [candidate] : [];
          } catch {
            return [];
          }
        });
      }),
  );
  const payload = {
    games: rankFeatured(
      results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    ),
    updatedAt: new Date().toISOString(),
    partial: results.some((r) => r.status === "rejected"),
    unavailable:
      !results.length || results.every((r) => r.status === "rejected"),
  };
  await sql(
    env,
    "INSERT OR REPLACE INTO cache VALUES(?,?,?)",
    key,
    JSON.stringify(payload),
    now() + 600,
  ).run();
  return payload;
}
