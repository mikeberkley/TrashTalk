import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
const address = execFileSync(
  "dig",
  ["+short", "trashtalk.fanlift.ai", "@1.1.1.1"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
if (!address) throw Error("Public DNS unavailable");
async function checkedFetch(url: string, opts: any = {}) {
  const output = execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--resolve",
      `trashtalk.fanlift.ai:443:${address}`,
      "-D",
      "-",
      "-o",
      "/dev/null",
      "-X",
      opts.method || "GET",
      ...(opts.body ? ["--data", opts.body] : []),
      url,
    ],
    { encoding: "utf8" },
  );
  return {
    status: Number(output.match(/HTTP\/[^ ]+ (\d+)/)?.[1]),
    headers: {
      get: (name: string) =>
        output.match(new RegExp("^" + name + ": (.*)$", "im"))?.[1]?.trim(),
    },
  };
}
const origin = "https://trashtalk.fanlift.ai";
const checks = [];
for (const path of [
  "/assets/index-BQROrKlB.js",
  "/api/me",
  "/api/billing/checkout",
  "/api/generations",
]) {
  const response = await checkedFetch(origin + path, {
    method:
      path === "/api/billing/checkout" || path === "/api/generations"
        ? "POST"
        : "GET",
  });
  checks.push({
    path,
    status: response.status,
    noStore: response.headers.get("cache-control") === "no-store",
  });
  if (response.status !== 503) throw Error("Launch hold not active: " + path);
}
const webhook = await checkedFetch(origin + "/api/billing/webhook", {
  method: "POST",
  body: "{}",
});
expect(webhook.status).toBe(400);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [`--host-resolver-rules=MAP trashtalk.fanlift.ai ${address}`],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "Sports rivalry. Made personal." }),
  ).toBeVisible();
  await page.screenshot({ path: "reports/production-hold.png" });
} finally {
  await browser.close();
}
const report = {
  checkedAt: new Date().toISOString(),
  origin,
  dnsVerification:
    "Cloudflare public resolver; explicit address used because local resolver retained negative cache",
  checks,
  unsignedWebhookStatus: webhook.status,
  publicLaunch: false,
  livePaymentsEnabled: false,
};
await fs.writeFile(
  "reports/production-preparation.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
