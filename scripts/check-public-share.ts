import { chromium, webkit, devices, expect } from "@playwright/test";
import fs from "node:fs/promises";
const url = process.argv[2];
if (!url?.startsWith("https://trashtalk.fanlift.ai/m/"))
  throw Error("Pass an existing public meme URL");
const results: any[] = [];
for (const engine of ["webkit", "chrome"]) {
  const browser = await (engine === "webkit"
    ? webkit.launch()
    : chromium.launch({ channel: "chrome", headless: true }));
  const page = await browser.newPage(
    engine === "webkit"
      ? { ...devices["iPhone 13"] }
      : { viewport: { width: 1440, height: 1000 } },
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript({
    content:
      "Object.defineProperty(navigator,'share',{value:function(data){window.__shared=data;return Promise.resolve();}});",
  });
  const response = await page.goto(url);
  expect(response?.status()).toBe(200);
  await page.locator("img").evaluate((el: HTMLImageElement) => el.decode());
  await page.evaluate(() => document.fonts.ready);
  const title = await page.title();
  expect(title).toMatch(/^.+ vs .+$/);
  expect(title).not.toContain(" — ");
  expect(
    await page.locator('meta[property="og:title"]').getAttribute("content"),
  ).toBe(title);
  expect(
    await page.locator('meta[name="twitter:title"]').getAttribute("content"),
  ).toBe(title);
  await expect(page.locator("body img")).toHaveCount(1);
  await expect(page.locator("body button")).toHaveCount(1);
  await expect(page.locator("body a")).toHaveCount(1);
  await expect(page.locator("header,footer,h1,p")).toHaveCount(0);
  const share = page.getByRole("button", { name: "Share" });
  if (engine === "webkit") await share.tap();
  else await share.click();
  expect(await page.evaluate(() => (window as any).__shared)).toEqual({
    title,
    url,
  });
  await expect(
    page.getByRole("link", { name: "Make your own" }),
  ).toHaveAttribute("href", "/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `reports/public-share-${engine}.png`,
    fullPage: true,
  });
  results.push({
    engine,
    title,
    imageLoaded: true,
    minimalContent: true,
    nativePayload: true,
    overflow: false,
    errors,
  });
  await browser.close();
}
await fs.writeFile(
  "reports/public-share.json",
  JSON.stringify(results, null, 2),
);
console.log(results);
