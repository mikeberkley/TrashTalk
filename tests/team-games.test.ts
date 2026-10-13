import { it, expect } from "vitest";
import {
  selectTeamGames,
  availableTeamGames,
} from "../worker/src/providers/team-games";
const at = Date.parse("2026-10-12T20:00:00Z");
const game = (id: string, date: string, status: string, team = "team") =>
  ({ id, date, status, home: { id: team }, away: { id: "opponent" } }) as any;
it("does not turn a failed current-season fetch plus an empty future season into an empty schedule", () => {
  const failed = {
    status: "rejected",
    reason: Error("feed unavailable"),
  } as const;
  const empty = { status: "fulfilled", value: [] } as const;
  expect(() =>
    availableTeamGames([failed, { ...empty, value: [] }], "team"),
  ).toThrow("Schedule unavailable");
  expect(availableTeamGames([{ ...empty, value: [] }], "team")).toEqual([]);
  const final = game("last", "2025-12-01", "final");
  expect(
    availableTeamGames(
      [failed, { status: "fulfilled", value: [final] }],
      "team",
    ),
  ).toEqual([final]);
});
it("adds only the latest finished game while keeping five upcoming games and deduplicating", () => {
  const latest = game("last", "2026-10-11", "final");
  const future = Array.from({ length: 6 }, (_, i) =>
    game(String(i), `2026-10-${13 + i}`, "scheduled"),
  );
  expect(
    selectTeamGames(
      [
        game("older", "2025-12-01", "final"),
        latest,
        latest,
        ...future,
        game("other", "2026-10-12", "final", "other"),
        game("cancelled", "2026-10-12", "unavailable"),
      ],
      "team",
      at,
    ).map((g) => g.id),
  ).toEqual(["last", "0", "1", "2", "3", "4"]);
});
it("returns the latest final even without upcoming games and preserves live games", () => {
  const final = game("last", "2025-12-01", "final");
  expect(selectTeamGames([final], "team", at)).toEqual([final]);
  const live = game("live", "2026-10-12", "live");
  expect(selectTeamGames([live], "team", at)).toEqual([live]);
});
