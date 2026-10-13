import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

// Reuse the homepage's approved logo, fonts, and palette for link previews.
const publicDir = "apps/web/public";
const data = async (path: string, type: string) =>
  `data:${type};base64,${(await fs.readFile(`${publicDir}/${path}`)).toString("base64")}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:Bangers;src:url('${await data("fonts/Bangers-Regular.ttf", "font/ttf")}')}
    @font-face{font-family:Barlow;src:url('${await data("fonts/Barlow-Regular.ttf", "font/ttf")}')}
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#101318;color:white;font-family:Barlow;overflow:hidden}
    main{padding:65px 80px;height:100%;border-bottom:12px solid #ccff66;background:radial-gradient(ellipse at 100% 0%,#58203f66,transparent 65%)}
    .brand{display:flex;align-items:center;gap:22px}.brand img{width:124px;height:124px}
    .wordmark{font:104px Bangers;letter-spacing:3px;transform:rotate(-3deg);text-shadow:4px 5px #58203f}.wordmark span{color:#ccff66}.wordmark b{font-weight:400;color:#ff66bb}
    h1{font:76px/1.06 Bangers;letter-spacing:2px;margin:42px 0 20px}h1 span{color:#ccff66}
    p{font-size:30px;margin:0;color:#e1e4e8}.url{font-size:24px;color:#a9b2be;margin-top:37px}
  </style></head><body><main>
    <div class="brand"><img src="${await data("trash-can-512.png", "image/png")}" alt=""><div class="wordmark">TRASH<span>TALK</span><b>!</b></div></div>
    <h1>Pick your side.<br><span>Talk your trash.</span></h1>
    <p>AI sports memes for your team rivalry.</p>
    <div class="url">trashtalk.fanlift.ai</div>
  </main></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator(".brand img")
    .evaluate((img: HTMLImageElement) => img.decode());
  await page.screenshot({ path: `${publicDir}/social-home-v2.png` });
} finally {
  await browser.close();
}
