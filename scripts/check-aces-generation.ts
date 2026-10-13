import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { validateArtwork } from "../worker/src/jobs/media";

const origin = "https://trashtalk.fanlift.ai";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const report: any = {
  origin,
  startedAt: new Date().toISOString(),
  steps: [],
  passed: false,
};
try {
  await page.goto(origin);
  await page.getByRole("combobox").fill("Las Vegas Aces");
  await page.getByRole("option").filter({ hasText: "Las Vegas Aces" }).click();
  await page.locator(".game").first().click();
  await expect(page.locator(".rooting")).toContainText("Las Vegas Aces");
  const me = await (await context.request.get(origin + "/api/me")).json();
  expect(me.trial).toBeGreaterThan(0);
  report.initialTrial = me.trial;
  const submitted = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/generations" &&
      r.request().method() === "POST",
  );
  await page.locator(".generate").click();
  const response = await submitted;
  const admitted = await response.json();
  expect(response.status(), JSON.stringify(admitted)).toBe(202);
  report.jobId = admitted.id;
  console.log("Aces generation admitted:", admitted.id);
  for (let i = 0; i < 100; i++) {
    const r = await context.request.get(
      `${origin}/api/generations/${admitted.id}`,
    );
    expect(r.ok()).toBe(true);
    const job = await r.json();
    if (report.steps.at(-1)?.status !== job.status) {
      report.steps.push({ status: job.status, at: new Date().toISOString() });
      console.log("Aces generation:", job.status);
    }
    if (job.status === "failed") throw Error(job.error || "Generation failed");
    if (job.status === "complete") {
      expect(job.favoriteTeamId).toBe("espn:wnba:17");
      const image = await context.request.get(origin + job.url);
      expect(image.ok()).toBe(true);
      const bytes = await image.body();
      const { width, height } = validateArtwork(bytes);
      report.artwork = { width, height };
      await fs.writeFile("reports/aces-generation.jpg", bytes);
      report.gameId = job.gameId;
      report.favoriteTeamId = job.favoriteTeamId;
      report.caption = job.text;
      report.finalTrial = (
        await (await context.request.get(origin + "/api/me")).json()
      ).trial;
      expect(report.finalTrial).toBe(report.initialTrial - 1);
      await expect(page.locator(".generate")).toHaveCount(0, {
        timeout: 15000,
      });
      await page.screenshot({
        path: "reports/aces-generation-390.png",
        fullPage: true,
      });
      report.passed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  expect(report.passed, "Generation did not finish within five minutes").toBe(
    true,
  );
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await fs.writeFile(
    "reports/aces-generation.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
