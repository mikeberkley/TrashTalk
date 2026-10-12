import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { testEnv } from "./harness";
it("publishes only the image and two actions with escaped matchup metadata", async () => {
  const { env, db } = testEnv();
  const context = {
    away: { displayName: "A & <B>" },
    home: { displayName: 'C "D"' },
    leagueLabel: "Private league detail",
    date: "2026-10-12",
    statusText: "Private status",
  };
  db.prepare(
    "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,context,caption) VALUES('j','owner','key','hash','{}','complete',0,0,?,?)",
  ).run(JSON.stringify(context), JSON.stringify({ text: "Meme caption" }));
  db.prepare("INSERT INTO shares VALUES('token','j',0,0)").run();
  const request = () =>
    worker.fetch(new Request("http://localhost/m/token"), env, {} as any);
  expect((await request()).status).toBe(404);
  db.prepare("UPDATE shares SET published=1").run();
  const result = await request();
  const html = await result.text();
  expect(result.status).toBe(200);
  const title = "A &amp; &lt;B&gt; vs C &quot;D&quot;";
  expect(html).toContain(`<title>${title}</title>`);
  expect(html).toContain(`property="og:title" content="${title}"`);
  expect(html).toContain(`name="twitter:title" content="${title}"`);
  const body = html.split("<body>")[1];
  expect(body.match(/<img /g)).toHaveLength(1);
  expect(body.match(/<button /g)).toHaveLength(1);
  expect(body.match(/<a /g)).toHaveLength(1);
  expect(body).toContain("Make your own");
  expect(body).not.toContain("<h1");
  expect(body).not.toContain("<p>");
  expect(body).not.toContain("Private");
  expect(html).toContain('src="/share.js"');
});
