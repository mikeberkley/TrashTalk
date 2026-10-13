import { chromium, webkit, devices, expect } from "@playwright/test";
import fs from "node:fs/promises";
const report: any[] = [];
for (const engine of ["chrome", "webkit"]) {
  const browser = await (engine === "chrome"
    ? chromium.launch({ channel: "chrome", headless: true })
    : webkit.launch());
  const page = await browser.newPage(
    engine === "webkit"
      ? { ...devices["iPhone 13"] }
      : { viewport: { width: 390, height: 844 } },
  );
  const tap = async (locator: any) =>
    engine === "webkit" ? locator.tap() : locator.click();
  await page.goto("https://trashtalk.fanlift.ai");
  for (const [label, heading] of [
    ["My trash talk", "My trash talk"],
    ["Credits", "Credits"],
    ["Account", "Account"],
    ["Make a meme", "Step 1: Pick a team"],
  ]) {
    await tap(page.getByLabel("Navigation menu"));
    await tap(page.getByRole("button", { name: label, exact: true }));
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("navigation")).toBeHidden();
  }
  await tap(page.getByLabel("Navigation menu"));
  await tap(page.locator("footer"));
  await expect(page.getByRole("navigation")).toBeHidden();
  const fixture = {
    id: "ui-result-fixture",
    status: "complete",
    text: "Fixture meme",
    url: "/social.png",
    shareToken: "test-token",
    gameId: "nfl:401873001",
    favoriteTeamId: "espn:football:17",
  };
  await page.route("**/api/me", (r) =>
    r.fulfill({
      json: {
        csrf: "fixture",
        trial: 5,
        paid: 0,
        environment: "production",
        authenticated: false,
      },
    }),
  );
  await page.route("**/api/my-images", (r) => r.fulfill({ json: [fixture] }));
  await page.route("**/api/generations/ui-result-fixture", (r) =>
    r.fulfill({ json: fixture }),
  );
  await page.route("**/api/generations/ui-result-fixture/share", (r) =>
    r.fulfill({ json: { url: "https://trashtalk.fanlift.ai/m/test-token" } }),
  );
  await page.addInitScript({
    content:
      "Object.defineProperty(navigator,'share',{value:function(data){window.__shared=data;return Promise.resolve();}});",
  });
  await page.evaluate(() =>
    sessionStorage.setItem("tt-job", "ui-result-fixture"),
  );
  await page.reload();
  const actions = page.locator(".result-actions");
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button")).toHaveCount(1);
  const share = actions.getByRole("button", { name: "Share" });
  await expect(share).toHaveClass(/primary/);
  await expect(
    page.getByText("To save to Photos on iPhone", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Save|Roast them again/ }),
  ).toHaveCount(0);
  await tap(share);
  expect(await page.evaluate(() => (window as any).__shared?.url)).toContain(
    "/m/test-token",
  );
  await page.screenshot({
    path: `reports/result-share-${engine}.png`,
    fullPage: true,
  });
  await tap(page.getByRole("link", { name: "View all my trash talk" }));
  await expect(
    page.getByRole("heading", { name: "My trash talk", exact: true }),
  ).toBeVisible();
  await tap(page.locator(".history button").first());
  await expect(actions).toBeVisible();
  await expect(page.locator(".result")).toBeVisible();
  const back = page.getByRole("link", {
    name: "Back to My Trash Talk",
    exact: true,
  });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.y).toBeLessThan(
    (await page.locator(".artwork").boundingBox())!.y,
  );
  await tap(back);
  await expect(
    page.getByRole("heading", { name: "My trash talk", exact: true }),
  ).toBeVisible();
  await tap(page.locator(".history button").first());
  await expect(back).toBeVisible();

  await tap(page.getByLabel("Navigation menu"));
  await tap(page.getByRole("button", { name: "Make a meme", exact: true }));
  await expect(
    page.getByRole("heading", { name: "Step 1: Pick a team" }),
  ).toBeVisible();
  await expect(page.locator(".result")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toBeHidden();
  await tap(page.getByLabel("Navigation menu"));
  await tap(page.getByRole("button", { name: "My trash talk", exact: true }));
  await tap(page.locator(".history button").first());
  await expect(back).toBeVisible();
  await tap(page.getByRole("link", { name: "Make another one" }));
  await expect(
    page.getByRole("heading", { name: "Step 2: add chaos" }),
  ).toBeVisible();
  await tap(page.getByRole("link", { name: "TrashTalk — back to Step 1" }));
  await expect(
    page.getByRole("heading", { name: "Step 1: Pick a team" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveValue("");
  const saved = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("tt-form") || "{}"),
  );
  expect(saved.game).toBeNull();
  expect(saved.team).toBeNull();
  await tap(page.getByLabel("Navigation menu"));
  await tap(page.getByRole("button", { name: "My trash talk", exact: true }));
  const item = page.locator(".history-item").first();
  await expect(
    item.getByRole("link", { name: "Share", exact: true }),
  ).toBeVisible();
  await expect(
    item.getByRole("link", { name: "Delete", exact: true }),
  ).toBeVisible();
  await expect(item.locator("span")).toHaveCount(0);
  await tap(item.getByRole("link", { name: "Share", exact: true }));
  expect(await page.evaluate(() => (window as any).__shared.url)).toContain(
    "/m/test-token",
  );
  await page.route("**/api/generations/ui-result-fixture", (r) =>
    r.fulfill({
      json: r.request().method() === "DELETE" ? { deleted: true } : fixture,
    }),
  );
  page.once("dialog", (d) => d.dismiss());
  await tap(item.getByRole("link", { name: "Delete", exact: true }));
  await expect(item).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await tap(item.getByRole("link", { name: "Delete", exact: true }));
  await expect(page.locator(".history-item")).toHaveCount(0);
  await page.screenshot({
    path: `reports/collection-empty-${engine}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  report.push({
    engine,
    menuDestinations: 4,
    outsideDismiss: true,
    shareOnly: true,
    sharePayload: true,
    resultLinks: true,
    collectionBackLink: true,
    overflow: false,
    resultFixture: true,
    logoResetsFlow: true,
    menuResetsFlowFromImage: true,
    collectionShareAndDelete: true,
  });
  await browser.close();
}
await fs.writeFile(
  "reports/result-navigation.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
