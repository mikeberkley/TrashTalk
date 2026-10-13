import { chromium, expect, request } from "@playwright/test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = process.argv.includes("--production")
  ? "https://trashtalk.fanlift.ai"
  : "https://trashtalk-preview.berkleym.workers.dev";
const environment = process.argv.includes("--production")
  ? "production"
  : "preview";
const records = JSON.parse(
  await fs.readFile("catalog-cache/league-expansion/records.json", "utf8"),
);
const api = await request.newContext({ baseURL: origin });
const teamsResponse = await api.get("/api/teams");
expect(teamsResponse.ok()).toBe(true);
const teams = await teamsResponse.json();
const leagues = await (await api.get("/api/leagues")).json();
expect(leagues.map((l: any) => l.id)).toEqual(
  expect.arrayContaining(["wnba", "ncaaf"]),
);
const expected = records.filter((r: any) => !r.metadata.catalogOpponent);
for (const { metadata: m } of expected) {
  const actual = teams.find((t: any) => t.id === m.id);
  expect(actual, m.displayName).toBeTruthy();
  expect(actual.displayName).toBe(m.displayName);
  if (m.conference)
    expect(actual.leagueLabels.join(" ")).toContain(m.conference.name);
}
const newTeams = teams.filter(
  (t: any) =>
    t.id.startsWith("espn:wnba:") || t.id.startsWith("espn:college-football:"),
);
expect(newTeams).toHaveLength(expected.length);
let cursor = 0;
const logoChecks: any[] = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (cursor < records.length) {
      const { metadata: m } = records[cursor++];
      const url = `/branding/${m.id.split(":").slice(1).join("/")}/${m.version}`;
      const r = await api.get(url);
      expect(r.ok(), url).toBe(true);
      expect(r.headers()["content-type"]).toContain("image/png");
      const hash = createHash("sha256")
        .update(await r.body())
        .digest("hex");
      expect(hash, m.displayName).toBe(m.logoHash);
      logoChecks.push({ id: m.id, verified: true });
    }
  }),
);
for (const id of ["wnba", "ncaaf"])
  expect((await api.get(`/branding/league/${id}`)).ok()).toBe(true);
const samples = [
  "Indiana Fever",
  "Toronto Tempo",
  "Alabama Crimson Tide",
  "Ohio State Buckeyes",
  "Texas Tech Red Raiders",
  "Clemson Tigers",
  "Notre Dame Fighting Irish",
  "Boise State Broncos",
];
const schedules = [];
for (const name of samples) {
  const team = teams.find((t: any) => t.displayName === name);
  expect(team, name).toBeTruthy();
  const r = await api.get(`/api/teams/${team.id}/games`);
  expect(r.ok(), name).toBe(true);
  const games = await r.json();
  expect(games.length, name).toBeGreaterThan(0);
  for (const game of games) {
    expect([game.home.id, game.away.id]).toContain(team.id);
    expect(
      game.home.brandingUrl,
      `${name}: ${game.home.displayName}`,
    ).toBeTruthy();
    expect(
      game.away.brandingUrl,
      `${name}: ${game.away.displayName}`,
    ).toBeTruthy();
  }
  const detail = await api.get(`/api/games/${games[0].id}`);
  expect(detail.ok()).toBe(true);
  const game = await detail.json();
  expect(game.home.id).toBe(games[0].home.id);
  expect(game.away.id).toBe(games[0].away.id);
  schedules.push({
    team: name,
    games: games.map((g: any) => g.id),
    detailVerified: true,
  });
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const browserChecks = [];
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  await page.addInitScript(() => sessionStorage.clear());
  page.on("pageerror", (e) => errors.push(e.message));
  for (const name of ["Indiana Fever", "Alabama Crimson Tide"]) {
    await page.goto(origin);
    await page.getByRole("combobox").fill(name);
    const option = page.getByRole("option").filter({ hasText: name });
    await expect(option).toHaveCount(1);
    await expect(option.locator("img")).toBeVisible();
    await expect
      .poll(() =>
        option
          .locator("img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: `reports/league-expansion-${environment}-${name.split(" ")[0].toLowerCase()}-search-${width}.png`,
    });
    await option.click();
    await page.locator(".game").first().waitFor();
    await page.locator(".game").first().click();
    await expect(
      page.getByRole("heading", { name: "Step 2: add chaos" }),
    ).toBeVisible();
    await expect(page.locator(".rooting")).toContainText(name);
    await expect(page.locator(".generate")).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    expect(
      await page
        .locator("img.team-logo")
        .evaluateAll((imgs) =>
          imgs.every(
            (img) =>
              (img as HTMLImageElement).complete &&
              (img as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/league-expansion-${environment}-${name.split(" ")[0].toLowerCase()}-game-${width}.png`,
      fullPage: true,
    });
    browserChecks.push({
      width,
      team: name,
      generationReady: true,
      overflow: false,
    });
  }
  expect(errors).toEqual([]);
  await page.close();
}
await browser.close();
await api.dispose();
const conferenceCounts: Record<string, number> = {};
for (const { metadata: m } of records)
  if (m.conference)
    conferenceCounts[m.conference.name] =
      (conferenceCounts[m.conference.name] || 0) + 1;
const report = {
  origin,
  checkedAt: new Date().toISOString(),
  selectableTeams: expected.length,
  wnbaTeams: newTeams.filter((t: any) => t.id.startsWith("espn:wnba:")).length,
  fbsTeams: newTeams.filter((t: any) =>
    t.id.startsWith("espn:college-football:"),
  ).length,
  conferenceCounts,
  logoChecks,
  schedules,
  browserChecks,
  paidGenerationAttempted: false,
};
await fs.writeFile(
  `reports/league-expansion-${environment}.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({ ...report, logoChecks: logoChecks.length }, null, 2),
);
