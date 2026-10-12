import fs from "node:fs/promises";
import { espn } from "../worker/src/providers/espn";
import {
  researchRequest,
  validateResearch,
  openrouter,
} from "../worker/src/research";
import {
  imageRequest,
  captionPrompt,
} from "../packages/trash-talk/src/prompts";
import { validateArtwork, dataUrl } from "../worker/src/jobs/media";
import sharp from "sharp";
const vars = await fs.readFile(".dev.vars.preview", "utf8");
const key = vars.match(/^OPENROUTER_API_KEY\s*=\s*["']?([^\s"']+)/m)?.[1];
if (!key) throw Error("Missing secure key");
const env: any = {
  OPENROUTER_API_KEY: key,
  ORIGIN: "https://trashtalk.fanlift.ai",
};
const games = await espn.listGames("nfl", "2026-10-11");
const g = await espn.getGame(games[0].id);
await fs.writeFile("reports/probe-game.json", JSON.stringify(g, null, 2));
const rr = await openrouter(env, "chat/completions", researchRequest(g), 20000);
await fs.writeFile("reports/search-probe.json", JSON.stringify(rr, null, 2));
let research: any;
try {
  research = validateResearch(rr, g);
  console.log(
    "Search execution verified:",
    research.searchRequests,
    "Citations:",
    research.citations.length,
  );
} catch (e) {
  console.log(String(e));
}
if (!process.argv.includes("--images")) process.exit(0);
const records = JSON.parse(
  await fs.readFile("catalog-cache/records.json", "utf8"),
);
const context: any = { ...g, favorite: "away", research };
for (const side of ["away", "home"] as const) {
  const t = records.find((x: any) => x.metadata.id === g[side].id);
  context[side] = {
    ...t.metadata,
    color: t.metadata.primary,
    logo: dataUrl(new Uint8Array(await fs.readFile(t.pngPath)), "image/png"),
  };
}
const caption = await openrouter(
  env,
  "chat/completions",
  {
    model: "x-ai/grok-4.3",
    reasoning: { effort: "low" },
    messages: [
      { role: "system", content: captionPrompt("", true) },
      {
        role: "user",
        content: JSON.stringify({
          ...context,
          home: { ...context.home, logo: undefined },
          away: { ...context.away, logo: undefined },
        }),
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  },
  45000,
);
const phrase = JSON.parse(caption.choices[0].message.content);
await fs.writeFile(
  "reports/caption-probe.json",
  JSON.stringify(caption, null, 2),
);
// Deterministic personal-object references keep the endpoint probe independent of anyone's private photos.
const refs = [];
for (const [name, svg] of [
  [
    "red-mug",
    '<rect x="50" y="60" width="120" height="140" rx="20" fill="red"/><circle cx="188" cy="110" r="28" fill="none" stroke="red" stroke-width="15"/>',
  ],
  [
    "blue-robot",
    '<rect x="70" y="45" width="115" height="110" rx="15" fill="royalblue"/><circle cx="100" cy="85" r="10" fill="white"/><circle cx="155" cy="85" r="10" fill="white"/><rect x="80" y="165" width="95" height="60" fill="royalblue"/>',
  ],
]) {
  const b = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="white"/>${svg}</svg>`,
    ),
  )
    .png()
    .toBuffer();
  await fs.writeFile(`reports/${name}.png`, b);
  refs.push(dataUrl(b, "image/png"));
}
for (const count of [0, 1]) {
  try {
    const start = Date.now();
    const d = await openrouter(
      env,
      "images",
      imageRequest(context, phrase, refs.slice(0, count)),
      120000,
    );
    const bytes = Uint8Array.from(Buffer.from(d.data[0].b64_json, "base64")),
      info = validateArtwork(bytes);
    await fs.writeFile(
      `reports/image-${count}-references.${info.mime === "image/png" ? "png" : "jpg"}`,
      bytes,
    );
    await fs.writeFile(
      `reports/image-${count}-probe.json`,
      JSON.stringify(
        {
          model: d.model,
          id: d.id,
          usage: d.usage,
          referenceCount: 2 + count,
          elapsedMs: Date.now() - start,
          width: info.width,
          height: info.height,
          mime: info.mime,
          passed: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "Verified image endpoint with",
      2 + count,
      "ordered references",
    );
  } catch (e) {
    await fs.writeFile(
      `reports/image-${count}-probe.json`,
      JSON.stringify({
        passed: false,
        error: String(e),
        referenceCount: 2 + count,
      }),
    );
    console.log("Image probe failed:", String(e));
  }
}
