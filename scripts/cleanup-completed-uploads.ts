import { cf } from "./cloudflare";
import fs from "node:fs/promises";
const database = "bd437dbf-a29f-4ffe-89f6-f6a8b16a53b2";
async function query(sql: string, params: any[] = []) {
  const response = await cf(`/d1/database/${database}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data: any = await response.json();
  if (!data.success || !data.result?.[0]?.success)
    throw Error("Database query failed");
  return data.result[0].results;
}
const refs = await query(
  `SELECT DISTINCT json_extract(r.value,'$.id') AS id,json_extract(r.value,'$.key') AS object_key,j.owner FROM jobs j JOIN json_each(j.input,'$.references') r WHERE j.status='complete'`,
);
const cleaned = [];
for (const ref of refs) {
  if (
    typeof ref.object_key !== "string" ||
    !ref.object_key.startsWith("uploads/")
  )
    throw Error("Invalid upload key");
  const route =
    "/r2/buckets/trashtalk-production-media/objects/" +
    encodeURIComponent(ref.object_key);
  await cf(route, { method: "DELETE" });
  let absent = false;
  try {
    await cf(route);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Cloudflare API 404 "))
      absent = true;
    else throw e;
  }
  if (!absent) throw Error("Deletion not confirmed");
  await query("DELETE FROM uploads WHERE id=? AND owner=?", [
    ref.id,
    ref.owner,
  ]);
  cleaned.push({ id: ref.id, objectDeleted: true, uploadRecordDeleted: true });
}
await fs.writeFile(
  "reports/completed-upload-cleanup.json",
  JSON.stringify(
    { date: new Date().toISOString(), environment: "production", cleaned },
    null,
    2,
  ),
);
console.log("Removed and verified", cleaned.length, "completed-job uploads");
