import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route("**/api/**", (r) =>
    r.fulfill({
      json:
        new URL(r.request().url()).pathname === "/api/me"
          ? {
              csrf: "fixture",
              trial: 2,
              paid: 8,
              authenticated: true,
              paymentsReady: true,
              environment: "production",
            }
          : [],
    }),
  );
  await page.goto((process.env.CHECK_ORIGIN || "https://trashtalk.fanlift.ai") + "?verify=" + Date.now());
  await page.getByLabel("Navigation menu").click();
  await page.getByRole("button", { name: "Credits", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Credits", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".credit-balances > div")
      .filter({ hasText: "Free credits" })
      .locator("dd"),
  ).toHaveText("2");
  await expect(
    page
      .locator(".credit-balances > div")
      .filter({ hasText: "Paid credits" })
      .locator("dd"),
  ).toHaveText("8");
  await expect(
    page.getByRole("button", { name: "Buy 4 credits — $0.99" }),
  ).toBeVisible();
  expect(await page.locator(".account").innerText()).not.toMatch(/images/i);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `reports/credit-balances-${width}.png` });
  await page.close();
}
await browser.close();
console.log("Credits page passed at 390px and 1440px with simulated balances.");
