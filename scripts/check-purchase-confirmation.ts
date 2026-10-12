import { chromium, expect } from "@playwright/test";
const origin = process.env.CHECK_ORIGIN || "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  let paid = false;
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    const json =
      path === "/api/me"
        ? {
            csrf: "fixture",
            trial: 3,
            paid: paid ? 8 : 4,
            authenticated: true,
            environment: "production",
          }
        : path.includes("/billing/purchases/cs_fixture")
          ? {
              status: paid ? "paid" : "pending",
              credited: paid ? 1 : 0,
              amount: 99,
              credits: 4,
            }
          : [];
    return r.fulfill({ json });
  });
  await page.goto(origin + "/?checkout=success&session_id=cs_fixture");
  await expect(
    page.getByRole("heading", { name: "Confirming your purchase" }),
  ).toBeVisible();
  await expect(page.getByText("Your new credits have been added")).toHaveCount(
    0,
  );
  paid = true;
  await expect(
    page.getByRole("heading", { name: "You’re all set!" }),
  ).toBeVisible();
  await expect(
    page.getByText("4 image credits purchased for $0.99."),
  ).toBeVisible();
  await expect(page.getByText("You now have")).toContainText("8 paid credits");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `reports/purchase-confirmation-${width}.png` });
  await page.getByRole("button", { name: "Make a meme", exact: true }).click();
  expect(new URL(page.url()).search).toBe("");
  await expect(
    page.getByRole("heading", { name: "Step 1: pick a game" }),
  ).toBeVisible();
  await page.goto(origin + "/?checkout=success");
  await expect(
    page.getByText("The purchase reference is missing.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  await page.goto(origin + "/?checkout=canceled");
  await expect(
    page.getByRole("heading", { name: "Credits", exact: true }),
  ).toBeVisible();
  await page.close();
}
await browser.close();
console.log(
  "Purchase confirmation checks passed at 390px and 1440px; API responses mocked.",
);
