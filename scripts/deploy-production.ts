import fs from "node:fs/promises";
import { parse } from "jsonc-parser";
import { execFileSync } from "node:child_process";
const config = parse(await fs.readFile("wrangler.jsonc", "utf8"));
const vars = config.env.production.vars;
if (
  !vars.GOOGLE_CLIENT_ID ||
  vars.PREVIEW_UNLIMITED !== "false" ||
  vars.PAUSE_GENERATION !== "false" ||
  vars.LAUNCH_HOLD !== "false"
)
  throw Error(
    "Configure Google and explicitly clear the production launch pause after acceptance checks.",
  );
const secrets = JSON.parse(
  execFileSync("npx", ["wrangler", "secret", "list", "--env", "production"], {
    encoding: "utf8",
  }),
);
for (const name of [
  "OPENROUTER_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
])
  if (!secrets.some((s: any) => s.name === name))
    throw Error("Missing production secret " + name);
const coverage = JSON.parse(
  await fs.readFile("reports/catalog-coverage.json", "utf8"),
);
if (coverage.length !== 12 || coverage.some((l: any) => !l.ready))
  throw Error("Catalog coverage incomplete");
for (const report of [
  "stripe-test-e2e.json",
  "google-e2e.json",
  "physical-iphone-check.json",
]) {
  let data: any;
  try {
    data = JSON.parse(await fs.readFile("reports/" + report, "utf8"));
  } catch {
    throw Error("Required acceptance evidence missing: " + report);
  }
  if (data.passed !== true) throw Error("Acceptance gate failed: " + report);
}
execFileSync("npm", ["run", "verify"], { stdio: "inherit" });
execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "trashtalk-production",
    "--env",
    "production",
    "--remote",
  ],
  { stdio: "inherit" },
);
execFileSync("npx", ["wrangler", "deploy", "--env", "production"], {
  stdio: "inherit",
});
