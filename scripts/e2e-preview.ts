import fs from "node:fs/promises";
const origin = "https://trashtalk-preview.berkleym.workers.dev";
let cookie = "",
  csrf = "";
const evidence: any = {
  origin,
  startedAt: new Date().toISOString(),
  steps: [],
};
async function req(path: string, method = "GET", body?: any, idem?: string) {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: {
      cookie,
      Origin: origin,
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(idem ? { "Idempotency-Key": idem } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const c = r.headers.get("set-cookie");
  if (c) cookie = c.split(";")[0];
  const d: any = await r.json();
  if (!r.ok) throw Error(`${path}: ${r.status} ${d.error}`);
  return d;
}
const me = await req("/me");
csrf = me.csrf;
evidence.initialTrial = me.trial;
const games = await req("/games?league=nfl&date=2026-10-11");
const g = games[0];
const input = {
  gameId: g.id,
  favoriteTeamId: g.away.id,
  includeWord: "banana",
  referenceIds: [],
};
const key = crypto.randomUUID();
const job = await req("/generations", "POST", input, key);
const dupe = await req("/generations", "POST", input, key);
evidence.duplicateIdempotent = job.id === dupe.id;
for (let i = 0; i < 90; i++) {
  const j = await req("/generations/" + job.id);
  if (evidence.steps.at(-1)?.status !== j.status) {
    evidence.steps.push({ status: j.status, at: new Date().toISOString() });
    console.log("Preview job:", j.status);
  }
  if (j.status === "failed") {
    evidence.error = j.error;
    break;
  }
  if (j.status === "complete") {
    evidence.complete = j;
    const share = await req(`/generations/${j.id}/share`, "POST", {});
    evidence.share = share;
    const pub = await fetch(share.url);
    evidence.socialHtml = (await pub.text()).includes("og:image");
    const outsider = await fetch(origin + `/api/generations/${j.id}`);
    evidence.privateDenied = outsider.status === 404;
    const pic = await fetch(origin + j.url, { headers: { cookie } });
    await fs.writeFile(
      "reports/preview-e2e-image.jpg",
      Buffer.from(await pic.arrayBuffer()),
    );
    evidence.finalTrial = (await req("/me")).trial;
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
await fs.writeFile(
  "reports/preview-e2e.json",
  JSON.stringify(evidence, null, 2),
);
console.log(evidence);
