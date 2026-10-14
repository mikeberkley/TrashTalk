import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let batches = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: any = [];
    if (url.pathname === "/api/me")
      body = { csrf: "test", authenticated: false };
    if (url.pathname === "/api/featured-games") body = { games: [] };
    if (url.pathname === "/api/shared-memes") {
      const offset = url.searchParams.has("cursor") ? 10 : 0;
      batches++;
      body = {
        items: Array.from({ length: 10 }, (_, i) => ({
          token: `m${offset + i}`,
          createdAt: 100 - offset - i,
        })),
        nextCursor: offset ? null : "next",
      };
    }
    await route.fulfill({ json: body });
  });
  await page.route("**/m/*/image", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="orange"/></svg>',
    }),
  );
  await page.route("**/m/m0", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>Shared meme</body></html>",
    }),
  );
  await page.goto("http://127.0.0.1:5178");
  await expect(page.locator(".shared-gallery")).toHaveCount(0);
  expect(batches).toBe(0);
  await page
    .getByRole("link", { name: "See the latest TrashTalk memes" })
    .click();
  await expect(page.locator(".shared-gallery-grid a")).toHaveCount(10);
  expect(batches).toBe(1);
  await page.locator(".gallery-more").scrollIntoViewIfNeeded();
  await expect(page.locator(".shared-gallery-grid a")).toHaveCount(20);
  expect(batches).toBe(2);
  await expect(page.locator(".shared-gallery-grid a").first()).toHaveAttribute(
    "href",
    "/m/m0",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `reports/shared-gallery-${width}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await page.locator(".shared-gallery-grid a").first().click();
  await expect(page).toHaveURL(/\/m\/m0$/);
  await page.close();
}
await browser.close();
console.log(
  "Gallery batches, links and responsive layout passed at 390px and 1440px.",
);
