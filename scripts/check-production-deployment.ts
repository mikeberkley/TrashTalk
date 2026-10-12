import { cf } from "./cloudflare";
import fs from "node:fs/promises";
const response: any = await (
  await cf("/workers/scripts/trashtalk-production/deployments")
).json();
const latest = response.result.deployments[0];
const report = { checkedAt: new Date().toISOString(), deployment: latest };
await fs.writeFile(
  "reports/production-deployments.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
