import fs from "node:fs/promises";
import { leagues } from "../packages/contracts/src/leagues";
import { espn } from "../worker/src/providers/espn";
const date = new Date().toISOString().slice(0, 10);
const results = await Promise.all(
  leagues.map(async (league) => {
    try {
      const games = await espn.listGames(league.id, date);
      return {
        league: league.id,
        count: games.length,
        live: games
          .filter((game) => game.status === "live")
          .map((game) => game.id),
        passed: true,
      };
    } catch {
      return { league: league.id, passed: false };
    }
  }),
);
const report = {
  checkedAt: new Date().toISOString(),
  date,
  results,
  passed: results.every((row) => row.passed),
};
await fs.writeFile(
  "reports/launch-discovery.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
if (!report.passed) process.exitCode = 1;
