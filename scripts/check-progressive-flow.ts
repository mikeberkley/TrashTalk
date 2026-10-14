import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: any[] = [];
for (const width of [390, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://trashtalk.fanlift.ai");
  await expect(
    page.getByRole("heading", { name: "Who’s your team?" }),
  ).toBeVisible();
  await expect(page.locator(".creative")).toHaveCount(0);
  await page.getByRole("combobox").fill("Patriots");
  await page.getByRole("option").first().waitFor();
  await page.getByRole("combobox").press("Enter");
  await expect(
    page.getByRole("heading", { name: "New England Patriots" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "☆ Favorite team" }).click();
  await expect(page.getByRole("button", { name: "★ Favorited" })).toBeVisible();
  await page.locator(".game").first().waitFor();
  const games = await page.locator(".game").count();
  expect(games).toBeLessThanOrEqual(6);
  await page.screenshot({
    path: `reports/progressive-schedule-${width}.png`,
    fullPage: true,
  });
  const researchRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/research")) researchRequests.push(r.url());
  });
  await page.locator(".game").first().click();
  expect(researchRequests).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "Step 2: add chaos" }),
  ).toBeVisible();
  await expect(page.locator(".generate")).toBeEnabled();
  await expect(page.locator(".games")).toHaveCount(0);
  await expect(page.locator(".teams")).toHaveCount(0);
  await page.screenshot({
    path: `reports/progressive-personal-${width}.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "← Choose another game" }).click();
  await page.getByRole("button", { name: "← Switch teams" }).click();
  await expect(page.locator(".presets button")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".presets button")).toHaveCount(1);
  results.push({
    width,
    games,
    researchStarted: false,
    favoritePersisted: true,
    overflow,
    errors,
  });
  await context.close();
}
await browser.close();
await fs.writeFile(
  "reports/progressive-flow.json",
  JSON.stringify(results, null, 2),
);
console.log(results);
