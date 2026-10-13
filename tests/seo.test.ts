import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { testEnv } from "./harness";

it("provides crawler discovery only for production and excludes preview legal pages", async () => {
  const { env } = testEnv();
  const ctx = { waitUntil() {} } as any;
  const request = (path: string) =>
    worker.fetch(new Request(`http://localhost${path}`), env, ctx);
  expect(await (await request("/robots.txt")).text()).toContain("Disallow: /");
  expect((await request("/privacy")).headers.get("X-Robots-Tag")).toContain(
    "noindex",
  );
  env.ENVIRONMENT = "production";
  const robots = await (await request("/robots.txt")).text();
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toContain("Sitemap: https://trashtalk.fanlift.ai/sitemap.xml");
  const sitemap = await request("/sitemap.xml");
  expect(sitemap.headers.get("Content-Type")).toContain("application/xml");
  expect(await sitemap.text()).toContain(
    "<loc>https://trashtalk.fanlift.ai/privacy</loc>",
  );
  expect((await request("/privacy")).headers.get("X-Robots-Tag")).toBeNull();
});
it("ships parseable app and website schema plus complete homepage previews", () => {
  const html = readFileSync("apps/web/index.html", "utf8");
  const schema = JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1],
  );
  expect(schema["@graph"].map((node: any) => node["@type"])).toEqual([
    "WebSite",
    "WebApplication",
  ]);
  expect(html).toContain('content="summary_large_image"');
  expect(html).toContain('property="og:image:width" content="1200"');
  expect(html).toContain(
    'rel="canonical" href="https://trashtalk.fanlift.ai/"',
  );
});
