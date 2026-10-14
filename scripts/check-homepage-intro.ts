import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const origin = process.argv.includes("--production")
  ? "https://trashtalk.fanlift.ai"
  : "http://127.0.0.1:5178";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const team = {
  id: "espn:football:1",
  displayName: "New England Patriots",
  leagueLabels: ["NFL"],
};
const game = {
  id: "nfl:123",
  leagueLabel: "NFL",
  status: "scheduled",
  scheduledAt: new Date().toISOString(),
  away: team,
  home: { id: "espn:football:2", displayName: "New York Jets" },
  score: {},
};
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (!process.argv.includes("--production"))
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        path === "/api/me"
          ? {
              csrf: "test",
              authenticated: false,
              environment: "production",
              trial: 5,
              paid: 0,
            }
          : path === "/api/teams"
            ? [team]
            : path === "/api/shared-memes"
              ? { items: [], nextCursor: null }
              : path === "/api/featured-games"
                ? { games: [], updatedAt: new Date().toISOString() }
                : path.endsWith("/games")
                  ? [game]
                  : path.startsWith("/api/games/")
                    ? game
                    : [];
      return route.fulfill({ json: body });
    });
  await page.goto(origin);
  await expect(
    page.getByRole("heading", {
      name: "Turn your sports rivalry into a hilarious meme.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Who’s your team?" }),
  ).toBeVisible();
  await expect(page.locator(".welcome-trial")).toContainText(
    "No sign-up required.",
  );
  await expect(page.locator(".welcome-example img")).toHaveJSProperty(
    "naturalWidth",
    640,
  );
  await page.evaluate(() => document.fonts.ready);
  const search = await page.getByRole("combobox").boundingBox();
  expect(search!.y + search!.height).toBeLessThan(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `reports/homepage-intro-${origin.startsWith("https") ? "production" : "local"}-${width}.png`,
    fullPage: true,
  });
  await page.getByRole("combobox").fill("Patriots");
  await page.getByRole("option").first().waitFor();
  await page.getByRole("combobox").press("Enter");
  await expect(page.locator(".welcome-intro")).toHaveCount(0);
  await page.locator(".game").first().click();
  await expect(page.locator(".generate")).toBeEnabled();
  await expect(page.locator(".photo-hint")).toContainText(
    "Want to put yourself—or a rival fan—in the meme? Add a photo.",
  );
  await expect(page.locator(".chaos-instruction")).toContainText(
    "No joke to write. No photo needed.",
  );
  expect(errors).toEqual([]);
  results.push({
    width,
    searchBottom: search!.y + search!.height,
    exampleLoaded: true,
    creationEnabledWithoutPhotoOrWord: true,
    errors,
  });
  await page.close();
}
await browser.close();
await fs.writeFile(
  `reports/homepage-intro-${origin.startsWith("https") ? "production" : "local"}.json`,
  JSON.stringify({ origin, results }, null, 2),
);
console.log(results);
