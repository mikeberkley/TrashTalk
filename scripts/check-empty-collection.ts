import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const authenticated of [false, true]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  if (authenticated)
    await page.route("**/api/me", (r) =>
      r.fulfill({
        json: {
          csrf: "fixture",
          trial: 3,
          paid: 0,
          environment: "production",
          authenticated: true,
        },
      }),
    );
  await page.route("**/api/my-images", (r) => r.fulfill({ json: [] }));
  await page.goto("https://trashtalk.fanlift.ai");
  await page.getByLabel("Navigation menu").click();
  await page
    .getByRole("button", { name: "My trash talk", exact: true })
    .click();
  await expect(
    page.getByText("No masterpieces of disrespect to display yet.", {
      exact: true,
    }),
  ).toBeVisible();
  const note = page.getByText(
    "Sign in with Google to see your saved trash talk across devices.",
    { exact: true },
  );
  if (authenticated) {
    await expect(note).toHaveCount(0);
    await expect(page.locator(".empty-history iframe")).toHaveCount(0);
  } else {
    await expect(note).toBeVisible();
    await expect(page.locator(".empty-history iframe")).toBeVisible({
      timeout: 20000,
    });
  }
  await page.screenshot({
    path: `reports/empty-collection-${authenticated ? "signed-in" : "anonymous"}.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Show some disrespect", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Step 1: pick a game" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  console.log({
    authenticated,
    emptyText: true,
    googleButton: !authenticated,
    stepOneLink: true,
  });
  await page.close();
}
await browser.close();
