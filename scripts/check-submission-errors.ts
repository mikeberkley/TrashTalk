import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
for (const width of [390, 1440]) {
  for (const scenario of [
    "anonymous-empty",
    "signed-in-empty",
    "rejected",
    "paid",
    "preview-unlimited",
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const game = {
      id: "nba:401000001",
      status: "scheduled",
      home: { id: "espn:basketball:13", displayName: "Los Angeles Lakers" },
      away: { id: "espn:basketball:9", displayName: "Golden State Warriors" },
    };
    await page.addInitScript(
      ({ game }) =>
        sessionStorage.setItem(
          "tt-form",
          JSON.stringify({
            team: game.home,
            game,
            favorite: game.home.id,
            word: "Cuddly",
            refs: [
              {
                id: "cd58738c-abea-456e-a990-30788cc0df58",
                url: "/social.png",
              },
            ],
          }),
        ),
      { game },
    );
    let submissions = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me")
        return route.fulfill({
          json: {
            csrf: "test",
            trial: scenario === "rejected" ? 1 : 0,
            paid: scenario === "paid" ? 4 : 0,
            authenticated: scenario === "signed-in-empty",
            generationUnlimited: scenario === "preview-unlimited",
            environment: "production",
          },
        });
      if (path === "/api/generations") {
        submissions++;
        return route.fulfill({
          status: 409,
          json: { error: "Photo missing or not owned by you" },
        });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(base);
    const action = page.locator(".generate");
    await expect(action).toBeEnabled();
    if (scenario.endsWith("empty")) {
      await expect(action).toHaveText(
        scenario === "anonymous-empty"
          ? "Sign in & get more credits"
          : "Get more credits",
      );
      await action.click();
      await expect(
        page.getByRole("heading", { name: "Credits", exact: true }),
      ).toBeInViewport();
      expect(submissions).toBe(0);
      const saved = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("tt-form")!),
      );
      expect(saved.word).toBe("Cuddly");
      expect(saved.refs).toHaveLength(1);
    } else {
      await expect(action).toHaveText("Unleash the meme");
      await action.click();
      const alert = page.getByRole("alert");
      await expect(alert).toHaveText(/Photo missing/);
      await expect(alert).toBeInViewport();
      await expect(alert).toBeFocused();
      expect(submissions).toBe(1);
      await page.getByRole("button", { name: "Dismiss message" }).click();
      await expect(alert).toHaveCount(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    console.log(`${width}px ${scenario}: passed`);
    await page.close();
  }
}
await browser.close();
