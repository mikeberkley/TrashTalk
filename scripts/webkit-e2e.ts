import { webkit, devices, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await webkit.launch();
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  acceptDownloads: true,
});
const page = await ctx.newPage();
const evidence: any = {
  engine: "Playwright WebKit",
  device: "iPhone 13 emulation, not physical Safari",
  errors: [],
};
page.on("pageerror", (e) => evidence.errors.push(e.message));
await page.addInitScript({
  content:
    "Object.defineProperty(navigator,'share',{value:function(data){window.__share={data:data,active:navigator.userActivation&&navigator.userActivation.isActive};return Promise.resolve();}});",
});
await page.goto("https://trashtalk-preview.berkleym.workers.dev");
await page.locator("select option").first().waitFor({ state: "attached" });
await page.locator("input[type=date]").fill("2026-10-11");
await page.locator(".game").first().click();
await page.locator(".teams button").first().click();
await expect(page.locator(".generate")).toBeEnabled();
await page
  .locator("input[type=file]")
  .setInputFiles("tests/fixtures/person.png");
await expect(page.locator(".photo")).toHaveCount(1);
const uploads = await page
  .locator(".photo img")
  .evaluateAll((imgs) => imgs.map((x) => (x as HTMLImageElement).src));
const outsider = await browser.newContext();
evidence.privatePhotoStatus = (await outsider.request.get(uploads[0])).status();
await page.locator(".generate").click();
await expect(page.locator(".artwork img")).toBeVisible({ timeout: 240000 });
const image = await page.locator(".artwork img").getAttribute("src");
const jobId = image!.split("/")[3];
const job = (await page.evaluate(
  async (id) => (await fetch("/api/generations/" + id)).json(),
  jobId,
)) as any;
const sharePath = "/m/" + job.shareToken;
evidence.beforeShareStatus = (
  await outsider.request.get(
    "https://trashtalk-preview.berkleym.workers.dev" + sharePath,
  )
).status();
await ctx.storageState({ path: "catalog-cache/webkit-state.json" });
await fs.writeFile(
  "reports/webkit-job.json",
  JSON.stringify({ job, uploads }, null, 2),
);
console.log(
  "WebKit share prepared",
  job.shareToken,
  await page.evaluate(() => typeof navigator.share),
);
await page
  .getByRole("button", { name: "↗ Share", exact: true })
  .first()
  .click();
await page.screenshot({ path: "reports/webkit-share-debug.png" });
console.log(
  "WebKit after click",
  await page.evaluate(() => (window as any).__share),
  await page.locator("[role=alert]").allTextContents(),
  evidence.errors,
);
await expect
  .poll(() => page.evaluate(() => (window as any).__share))
  .toBeTruthy();
evidence.nativeShareInvocation = await page.evaluate(
  () => (window as any).__share,
);
await expect
  .poll(async () =>
    (
      await outsider.request.get(evidence.nativeShareInvocation.data.url)
    ).status(),
  )
  .toBe(200);
evidence.afterShareStatus = 200;
const dl = page.waitForEvent("download");
await page.getByRole("link", { name: "↓ Save" }).click();
await (await dl).saveAs("reports/webkit-download.png");
await page.locator(".artwork").click();
await page.screenshot({ path: "reports/webkit-viewer.png" });
await page.getByRole("button", { name: "Close image" }).click();
evidence.focusRestored = await page
  .getByRole("button", { name: "↗ Share", exact: true })
  .first()
  .evaluate((e) => e === document.activeElement);
evidence.overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
await ctx.storageState({ path: "catalog-cache/webkit-state.json" });
await fs.writeFile(
  "reports/webkit-e2e.json",
  JSON.stringify(evidence, null, 2),
);
console.log(evidence);
await browser.close();
