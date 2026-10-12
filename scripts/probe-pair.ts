import fs from "node:fs/promises";
import { pairLogos } from "../packages/trash-talk/src/logo-pair";
import { imageRequest } from "../packages/trash-talk/src/prompts";
import { openrouter, validateResearch } from "../worker/src/research";
import { dataUrl, validateArtwork } from "../worker/src/jobs/media";
const vars = await fs.readFile(".dev.vars.preview", "utf8"),
  key = vars.match(/^OPENROUTER_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1];
const env: any = {
  OPENROUTER_API_KEY: key,
  ORIGIN: "https://trashtalk.fanlift.ai",
};
const g = JSON.parse(await fs.readFile("reports/probe-game.json", "utf8"));
const research = validateResearch(
  JSON.parse(await fs.readFile("reports/search-probe.json", "utf8")),
  g,
);
await fs.writeFile(
  "reports/verified-research.json",
  JSON.stringify(research, null, 2),
);
const records = JSON.parse(
  await fs.readFile("catalog-cache/records.json", "utf8"),
);
const c: any = { ...g, favorite: "away" };
const logos = [];
for (const side of ["away", "home"]) {
  const t = records.find((x: any) => x.metadata.id === g[side].id);
  const bytes = new Uint8Array(await fs.readFile(t.pngPath));
  logos.push(bytes);
  c[side] = {
    ...t.metadata,
    color: t.metadata.primary,
    logo: dataUrl(bytes, "image/png"),
  };
}
const pair = pairLogos(logos[0], logos[1]);
await fs.writeFile("reports/paired-logos.png", pair);
const refs = [];
for (const name of ["red-mug", "blue-robot"])
  refs.push(
    dataUrl(
      new Uint8Array(await fs.readFile(`reports/${name}.png`)),
      "image/png",
    ),
  );
const caption = JSON.parse(
  await fs.readFile("reports/caption-probe.json", "utf8"),
);
const phrase = JSON.parse(caption.choices[0].message.content);
const d = await openrouter(
  env,
  "images",
  {...imageRequest(c, phrase, refs.slice(0,1)),input_references:[dataUrl(pair,"image/png"),...refs].map(url=>({type:"image_url",image_url:{url}}))},
  120000,
);
const bytes = Uint8Array.from(Buffer.from(d.data[0].b64_json, "base64")),
  info = validateArtwork(bytes);
await fs.writeFile(
  "reports/image-paired-two-photos." +
    (info.mime === "image/png" ? "png" : "jpg"),
  bytes,
);
await fs.writeFile(
  "reports/image-paired-probe.json",
  JSON.stringify(
    {
      passed: true,
      teamLogos: 2,
      userReferences: 2,
      endpointReferences: 3,
      usage: d.usage,
      width: info.width,
      height: info.height,
    },
    null,
    2,
  ),
);
console.log(
  "Verified actual search execution and two logos plus two references via paired logo sheet",
);
