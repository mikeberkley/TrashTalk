import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const game = {
  id: "nfl:123",
  leagueLabel: "NFL",
  status: "live",
  periodDisplay: "Q4 · 1:00",
  score: { away: 21, home: 21 },
  away: { id: "espn:football:1", displayName: "New England Patriots" },
  home: { id: "espn:football:2", displayName: "New York Jets" },
  featuredReason: "Tied game",
};
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/me"
        ? { csrf: "test", authenticated: false }
        : path === "/api/shared-memes"
          ? { items: [], nextCursor: null }
          : path === "/api/featured-games"
            ? { games: [game], updatedAt: new Date().toISOString() }
            : path === "/api/teams"
              ? [
                  {
                    id: game.away.id,
                    displayName: game.away.displayName,
                    leagueLabels: ["NFL"],
                  },
                ]
              : path.startsWith("/api/games/")
                ? game
                : [];
    await route.fulfill({ json: body });
  });
  await page.addInitScript(
    (id) => localStorage.setItem("tt-favorites", JSON.stringify([id])),
    game.away.id,
  );
  await page.goto("http://127.0.0.1:5178");
  await expect(page.locator(".featured-game")).toHaveCount(1);
  const search = await page.getByRole("combobox").boundingBox(),
    featured = await page.locator(".featured-games").boundingBox(),
    favorites = await page.locator(".presets").boundingBox();
  expect(favorites!.y).toBeGreaterThan(search!.y + search!.height);
  expect(featured!.y).toBeGreaterThan(favorites!.y + favorites!.height);
  const favoriteCard = await page
    .locator(".presets button")
    .first()
    .boundingBox();
  const liveCard = await page.locator(".featured-game").first().boundingBox();
  expect(favoriteCard!.width).toBe(liveCard!.width);
  expect(favoriteCard!.height).toBe(liveCard!.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `reports/featured-games-${width}.png`,
    fullPage: true,
  });
  await page.locator(".featured-game").click();
  await expect(
    page.getByRole("heading", { name: "Step 2: add chaos" }),
  ).toBeVisible();
  await page.getByLabel("Who are you rooting for?").selectOption(game.away.id);
  await expect(page.locator(".generate")).toBeEnabled();
  expect(errors).toEqual([]);
  await page.close();
}
await browser.close();
console.log("Featured layout and selection passed at 390px and 1440px.");
