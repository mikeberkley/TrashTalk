import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto("https://trashtalk.fanlift.ai");
  await expect(
    page.getByRole("heading", { name: "Step 1: pick a game" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search by team" }),
  ).toBeVisible();
  await expect(page.getByText("Who’s playing?", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("navigation")).toBeHidden();
  await page.getByLabel("Navigation menu").click();
  for (const name of ["Make a meme", "My trash talk", "Credits", "Account"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Credits", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Credits", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toBeHidden();
  await page.getByLabel("Navigation menu").click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Navigation menu").click();
  await page.getByRole("button", { name: "Make a meme", exact: true }).click();
  await page.getByRole("combobox").fill("Patriots");
  await page.getByRole("option").first().click();
  await page.locator(".game").first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 500));
  expect(
    await page
      .locator("header")
      .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
  ).toBe(0);
  await page.getByLabel("Navigation menu").click();
  await page.getByLabel("Navigation menu").press("Escape");
  await expect(page.getByRole("navigation")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: `reports/header-menu-${width}.png` });
  console.log({ width, sticky: true, menu: true, copy: true, overflow: false });
  await page.close();
}
await browser.close();
