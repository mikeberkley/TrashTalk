const directions: Record<string, string> = {
  announcement: "A pompous fictional announcement about the rivalry.",
  quote: "An imaginary boast or confession; no real-person attribution.",
  habits: "An oddly specific embarrassing habit of the opposing team.",
  advice: "Condescending advice the opponent absolutely did not ask for.",
  prediction: "An absurdly overconfident prediction before kickoff.",
  premature:
    "A ridiculously premature celebration while the game is still live.",
  celebration:
    "A wildly disproportionate celebration of the favorite's victory.",
  excuse: "A transparently ridiculous excuse for the favorite's poor result.",
};

/** Pick a least-recently-used eligible mechanism; job ID spreads unseen choices. */
export function jokeDirection(
  situation: any,
  recent: { mechanism?: string }[],
  seed: string,
) {
  const eligible = ["announcement", "quote", "habits", "advice"];
  if (situation?.status === "upcoming") eligible.push("prediction");
  if (situation?.status === "live" && situation.outcome === "leading")
    eligible.push("premature");
  if (situation?.status === "final" && situation.outcome === "won")
    eligible.push("celebration");
  if (["lost", "trailing"].includes(situation?.outcome))
    eligible.push("excuse");
  const age = (id: string) => {
    const index = recent.findIndex((r) => r.mechanism === id);
    return index < 0 ? Infinity : index;
  };
  const oldest = Math.max(...eligible.map(age));
  const choices = eligible.filter((id) => age(id) === oldest);
  const hash = [...seed].reduce(
    (n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0,
    0,
  );
  const id = choices[hash % choices.length];
  return { id, instruction: directions[id] };
}

/** Compact avoidance hints, without old caption structures or score examples. */
export function recentThemes(recent: { theme?: string }[]) {
  return [
    ...new Set(
      recent.flatMap((r) =>
        r.theme ? [r.theme.replace(/\b\d+\s*[-–:/]\s*\d+\b/g, "").trim()] : [],
      ),
    ),
  ]
    .filter(Boolean)
    .slice(0, 6);
}
