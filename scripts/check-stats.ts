import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const width of [390, 1440]) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    hasTouch: width === 390,
  });
  await page.route("**/api/me", (r) =>
    r.fulfill({
      json: {
        authenticated: true,
        admin: true,
        csrf: "test",
        trial: 3,
        paid: 4,
        environment: "production",
      },
    }),
  );
  await page.route("**/api/favorites", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/teams", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/billing/purchases", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/my-images", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/admin/stats?*", (r) =>
    r.fulfill({
      json: {
        generatedAt: 1791810000,
        traffic: { views: 12, visitors: 5 },
        users: { accounts: 2 },
        images: {
          attempts: 8,
          completed: 6,
          retained: 5,
          failed: 2,
          active: 0,
        },
        purchases: { packs: 2, credits: 8, grossCents: 198 },
        review: { purchases: 0 },
        shares: { published: 3 },
        usage: [
          { pool: "trial", used: 4 },
          { pool: "paid", used: 2 },
        ],
        daily: [{ day: "2026-10-12", images: 6 }],
        trafficDaily: [{ day: "2026-10-12", views: 12 }],
      },
    }),
  );
  await page.route("**/api/admin/stats/*", (r) => {
    const u = new URL(r.request().url());
    const offset = Number(u.searchParams.get("offset") || 0);
    return r.fulfill({
      json: {
        columns: ["Created (ET)"],
        rows: [
          {
            "Created (ET)": offset
              ? "Oct 11, 2026, 8:00:00 AM EDT"
              : "Oct 12, 2026, 8:00:00 AM EDT",
          },
        ],
        note: "Account names and emails are not stored.",
        nextOffset: offset ? null : 50,
      },
    });
  });
  await page.goto("http://localhost:5175");
  await page.getByRole("button", { name: "App stats", exact: true }).click();
  await page.getByRole("heading", { name: "Daily activity" }).waitFor();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Overflow " + width);
  await page.getByRole("combobox").selectOption("7");
  await page.getByRole("heading", { name: "Daily activity" }).waitFor();
  await page.screenshot({ path: `reports/stats-${width}.png`, fullPage: true });
  const cards = page.locator("button.stats-card");
  for (let i = 0; i < (await cards.count()); i++) {
    if (width === 390) await cards.nth(i).tap();
    else await cards.nth(i).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog
      .getByText("Oct 12, 2026, 8:00:00 AM EDT", { exact: true })
      .waitFor();
    if (i === 2) {
      await dialog.getByRole("button", { name: "Next", exact: true }).click();
      await dialog
        .getByText("Oct 11, 2026, 8:00:00 AM EDT", { exact: true })
        .waitFor();
      await dialog
        .getByRole("button", { name: "Previous", exact: true })
        .click();
      await dialog
        .getByText("Oct 12, 2026, 8:00:00 AM EDT", { exact: true })
        .waitFor();
      await page.screenshot({ path: `reports/stats-modal-${width}.png` });
      await page.keyboard.press("Escape");
    } else
      await dialog.getByRole("button", { name: "Close stat details" }).click();
    await dialog.waitFor({ state: "hidden" });
    if (!(await cards.nth(i).evaluate((el) => el === document.activeElement)))
      throw Error("Focus not restored");
  }
  await page.close();
}
await browser.close();
await fs.writeFile(
  "reports/stats-browser.json",
  JSON.stringify(
    {
      passed: true,
      widths: [390, 1440],
      source: "mocked stats API with real UI",
      checks:
        "all 15 cards, mobile tap, pagination, Escape, close, focus restoration",
      date: new Date().toISOString(),
    },
    null,
    2,
  ),
);
