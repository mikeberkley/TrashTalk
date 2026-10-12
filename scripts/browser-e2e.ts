import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  acceptDownloads: true,
});
const page = await context.newPage();
const origin = "https://trashtalk-preview.berkleym.workers.dev";
const evidence: any = {
  origin,
  startedAt: new Date().toISOString(),
  results: [],
};
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(origin);
await page.locator("select option").first().waitFor({ state: "attached" });
for (const [league, date, photos] of [
  ["nfl", "2026-10-11", true],
  ["nba", "2026-10-13", false],
  ["epl", "2026-09-19", false],
] as const) {
  await page.locator("select").selectOption(league);
  await page.locator("input[type=date]").fill(date);
  await page.locator(".game").first().waitFor();
  await expect(page.locator(".game").first()).toContainText(
    league === "nfl" ? "NFL" : league === "nba" ? "NBA" : "Premier League",
  );
  await page.locator(".game").first().click();
  await page.locator(".teams button").first().click();
  await expect(page.locator(".generate")).toBeEnabled();
  if (photos) {
    await page.locator("input[type=file]").setInputFiles("reports/red-mug.png");
    await expect(page.locator(".photo")).toHaveCount(1);
  } else {
    while (await page.locator(".photo button").count())
      await page.locator(".photo button").first().click();
  }
  await page.locator('input[placeholder="e.g. banana"]').fill("banana");
  await page.locator(".generate").click();
  await page.locator(".result").waitFor();
  await expect(page.locator(".artwork img")).toBeVisible({ timeout: 240000 });
  const text = await page.locator(".artwork img").getAttribute("alt");
  const src = await page.locator(".artwork img").getAttribute("src");
  evidence.results.push({
    league,
    date,
    photos: photos ? 1 : 0,
    text,
    src,
    balance: await page.locator(".balance").innerText(),
  });
  console.log("Completed browser generation", league);
  await fs.writeFile(
    "reports/browser-e2e-progress.json",
    JSON.stringify(evidence, null, 2),
  );
  await page.screenshot({
    path: `reports/e2e-${league}-mobile.png`,
    fullPage: true,
  });
  if (photos) {
    await page.locator(".artwork").click();
    await expect(page.locator("dialog")).toBeVisible();
    await page.screenshot({ path: "reports/viewer-mobile.png" });
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).not.toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "↓ Save" }).click();
    const file = await download;
    await file.saveAs("reports/browser-download.png");
    evidence.downloaded = true;
    await page
      .getByRole("button", { name: "↗ Share link", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "↗ Share", exact: true }).first(),
    ).toBeVisible();
  }
}
await expect(page.locator(".balance")).toContainText("0 free");
await page
  .getByRole("button", { name: "Generate another", exact: true })
  .click();
await expect(page.getByRole("alert")).toContainText("Sign in with Google");
evidence.afterThreeGate = await page.getByRole("alert").innerText();
await page.reload();
await expect(page.locator(".artwork img")).toBeVisible();
evidence.resume = true;
await page.getByRole("button", { name: /My images/ }).click();
await expect(page.locator(".history img")).toHaveCount(3);
evidence.privateHistoryCount = 3;
evidence.errors = errors;
await fs.writeFile(
  "reports/browser-e2e.json",
  JSON.stringify(evidence, null, 2),
);
console.log(evidence);
await browser.close();
