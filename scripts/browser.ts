import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report: any[] = [];
for (const width of [390, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://trashtalk-preview.berkleym.workers.dev");
  await page.getByRole("heading", { name: "Pick your side." }).waitFor();
  await page.locator("select option").first().waitFor({ state: "attached" });
  await page.locator("input[type=date]").fill("2026-10-11");
  await page.locator(".game").first().waitFor();
  const count = await page.locator(".game").count();
  await page.locator(".game").first().click();
  await page.locator(".teams button").first().click();
  await expect(page.locator(".generate")).toBeEnabled();
  await page.screenshot({
    path: `reports/browser-${width}.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  report.push({
    width,
    gameCount: count,
    leagues: await page.locator("select option").count(),
    generateEnabled: await page.locator(".generate").isEnabled(),
    overflow,
    errors,
  });
  await context.close();
}
await fs.writeFile(
  "reports/browser-checks.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
await browser.close();
