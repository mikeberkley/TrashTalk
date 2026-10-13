import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  captionBase,
  logoInstruction,
  captionPrompt,
  imageRequest,
  originalImagePrompt,
} from "../packages/trash-talk/src/prompts";
import {
  validateIncludeWord,
  captionIncludesWord,
} from "../packages/trash-talk/src/include-word";
import {
  periodDisplay,
  normalize,
  rankMoments,
} from "../worker/src/providers/espn";
import { leagues } from "../packages/contracts/src/leagues";
import { validateResearch } from "../worker/src/research";
import { decodeImage, validateArtwork } from "../worker/src/jobs/media";
const c: any = {
  league: "nfl",
  leagueLabel: "NFL",
  favorite: "away",
  away: {
    name: "Eagles",
    city: "Philadelphia",
    abbr: "PHI",
    color: "#004C54",
    logo: "away",
  },
  home: {
    name: "Jaguars",
    city: "Jacksonville",
    abbr: "JAX",
    color: "#006778",
    logo: "home",
  },
};
const phrase = {
  text: "Your trophy is a participation banana",
  visual: "A fictional banana trophy",
};
describe("source preservation", () => {
  it("all 39 hashes remain exact", () => {
    const m = JSON.parse(
      fs.readFileSync("reference/SOURCE_MANIFEST.json", "utf8"),
    );
    expect(Object.keys(m.files)).toHaveLength(39);
    for (const [p, h] of Object.entries(m.files))
      expect(
        createHash("sha256")
          .update(fs.readFileSync("reference/" + p))
          .digest("hex"),
      ).toBe(h);
  });
  it("caption instructions use supplied game facts and prohibit ungrounded claims", () => {
    expect(captionBase).toContain('If gameContext.status is "upcoming"');
    expect(captionBase).toContain("gameContext.status is live");
    expect(captionBase).toContain("gameContext.status is final");
    expect(captionBase).not.toContain("latest supplied briefing");
    expect(captionBase).not.toContain("recent big play");
  });
  it("uses the approved league image prompt", () => {
    const prompt = originalImagePrompt(c, phrase);
    expect(prompt).toContain(
      "outrageously absurd trash-talk meme for this NFL game.",
    );
    expect(prompt).toContain(
      "The image’s artistic style must be exaggerated cartoon style.",
    );
    expect(prompt).toContain("generous 10% safe margins");
    expect(prompt).not.toContain("No identifiable players");
    expect(imageRequest(c, phrase, []).prompt).toBe(prompt + logoInstruction);
  });
  it("preserves model settings and reference order", () => {
    const r = imageRequest(c, phrase, ["person"]);
    expect(r).toMatchObject({
      model: "x-ai/grok-imagine-image-2.0",
      quality: "medium",
      resolution: "1K",
      aspect_ratio: "1:1",
      output_format: "png",
      n: 1,
      provider: { only: ["xai"], allow_fallbacks: false },
    });
    expect(r.input_references.map((x) => x.image_url.url)).toEqual([
      "away",
      "home",
      "person",
    ]);
  });
  it("rejects more than one personal photo", () =>
    expect(() => imageRequest(c, phrase, ["person", "pet"])).toThrow(
      "at most one photo",
    ));
  it("adapts the league and personal references", () => {
    expect(
      imageRequest({ ...c, league: "nba", leagueLabel: "NBA" }, phrase, [])
        .prompt,
    ).toBe(
      originalImagePrompt(c, phrase).replaceAll("NFL", "NBA") + logoInstruction,
    );
    expect(imageRequest(c, phrase, ["pet"]).prompt).toContain(
      "Use the user reference images for recognizable personalization",
    );
    expect(captionPrompt("", false)).toContain("innings, halves, or periods");
  });
  it("lowercases the user word before inserting it into the caption prompt", () => {
    expect(captionPrompt("BaNaNa", true)).toContain(
      'Required caption word: "banana".',
    );
    expect(captionPrompt("", true)).not.toContain("Required caption word:");
  });
  it.each(["bad word", "bad1", "damn", "hell", "a".repeat(31)])(
    "rejects invalid optional word %s",
    (w) => expect(validateIncludeWord(w).error).toBeTruthy(),
  );
  it("whole words only", () => {
    expect(captionIncludesWord("catch it", "cat")).toBe(false);
    expect(captionIncludesWord("CAT!", "cat")).toBe(true);
  });
});
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(fs.readFileSync("worker/migrations/0001_initial.sql", "utf8"));
  d.exec(
    "INSERT INTO principals(id,created_at) VALUES('a',0); INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES('a','grant',5,'trial','trial:a',0)",
  );
  return d;
}
const reserve = (d: DatabaseSync, id: string) =>
  d
    .prepare("INSERT INTO reservations VALUES(?,'a','trial','reserved')")
    .run(id);
const balance = (d: DatabaseSync) =>
  Number(
    (
      d
        .prepare(
          "SELECT SUM(amount) n FROM ledger WHERE owner='a' AND pool='trial'",
        )
        .get() as any
    ).n,
  );
describe("atomic ledger in real SQLite", () => {
  it("only five free successes", () => {
    const d = db();
    for (let i = 0; i < 5; i++) {
      reserve(d, "" + i);
      d.prepare("UPDATE reservations SET state='captured' WHERE job_id=?").run(
        "" + i,
      );
    }
    expect(balance(d)).toBe(0);
    expect(() => reserve(d, "6")).toThrow("insufficient_credit");
  });
  it("racing reservations cannot spend last credit twice", () => {
    const d = db();
    reserve(d, "1");
    reserve(d, "2");
    reserve(d, "3");
    reserve(d, "4");
    reserve(d, "5");
    expect(() => reserve(d, "6")).toThrow();
    expect(balance(d)).toBe(0);
  });
  it("release once and capture once", () => {
    const d = db();
    reserve(d, "1");
    d.exec(
      "UPDATE reservations SET state='released' WHERE job_id='1'; UPDATE reservations SET state='released' WHERE job_id='1'",
    );
    expect(balance(d)).toBe(5);
    reserve(d, "2");
    d.exec(
      "UPDATE reservations SET state='captured' WHERE job_id='2'; UPDATE reservations SET state='captured' WHERE job_id='2'",
    );
    expect(balance(d)).toBe(4);
  });
  it("duplicate reservation is rejected", () => {
    const d = db();
    reserve(d, "1");
    expect(() => reserve(d, "1")).toThrow();
    expect(balance(d)).toBe(4);
  });
  it("duplicate grant business keys cannot credit twice", () => {
    const d = db();
    for (let i = 0; i < 3; i++)
      d.exec(
        "INSERT OR IGNORE INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES('a','grant',5,'paid','purchase:checkout1',0)",
      );
    expect(
      (
        d
          .prepare("SELECT SUM(amount) n FROM ledger WHERE pool='paid'")
          .get() as any
      ).n,
    ).toBe(5);
  });
  it("job insert rolls back if reservation fails", () => {
    const d = db();
    for (let i = 0; i < 5; i++) reserve(d, "" + i);
    d.exec("BEGIN");
    try {
      d.exec(
        "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at) VALUES('j','a','k','h','{}','queued',0,0)",
      );
      reserve(d, "j");
      d.exec("COMMIT");
    } catch {
      d.exec("ROLLBACK");
    }
    expect(d.prepare("SELECT * FROM jobs WHERE id='j'").get()).toBeUndefined();
  });
  it("unique active job blocks cross-tab admission", () => {
    const d = db();
    const s = d.prepare(
      "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at) VALUES(?,'a',?,'h','{}','queued',0,0)",
    );
    s.run("1", "1");
    expect(() => s.run("2", "2")).toThrow();
  });
});
describe("sport facts and research", () => {
  it.each(leagues)("$id has stable IDs and nullable pregame scores", (l) => {
    const g = normalize(
      {
        id: "123",
        date: "2026-10-12",
        competitions: [
          {
            status: { type: { state: "pre", detail: "Scheduled" } },
            competitors: [
              {
                homeAway: "home",
                team: { id: "1", name: "A", displayName: "A" },
              },
              {
                homeAway: "away",
                team: { id: "2", name: "B", displayName: "B" },
              },
            ],
          },
        ],
      },
      l,
    );
    expect(g.score).toEqual({ home: null, away: null });
    expect(g.id).toBe(l.id + ":123");
  });
  it("preserves sport period terms", () => {
    expect(periodDisplay("baseball", 8, "", "Top 8th")).toBe("Top 8th");
    expect(periodDisplay("soccer", 3, "102:00", "")).toContain("Extra time");
    expect(periodDisplay("hockey", 5, "", "")).toContain("Shootout");
  });
  it("excludes corrected and conversion plays", () =>
    expect(
      rankMoments(
        [
          { text: "Touchdown overturned" },
          { text: "extra point good" },
          { text: "sacked quarterback" },
        ],
        "football",
      )[0].text,
    ).toBe("sacked quarterback"));
  it("requires actual search, not model claims", () =>
    expect(() =>
      validateResearch(
        { usage: {}, choices: [{ message: { content: "{}" } }] },
        {} as any,
      ),
    ).toThrow("Search execution"));
  it("real probe has search evidence and cited cards", () => {
    const r = validateResearch(
      JSON.parse(fs.readFileSync("reports/search-probe.json", "utf8")),
      JSON.parse(fs.readFileSync("reports/probe-game.json", "utf8")),
    );
    expect(r.searchRequests).toBe(1);
    expect(r.cards.length).toBeGreaterThan(0);
  });
  it("accepts fenced provider JSON while preserving source validation", () => {
    const d = JSON.parse(fs.readFileSync("reports/search-probe.json", "utf8"));
    d.choices[0].message.content =
      "```json\n" + d.choices[0].message.content + "\n```";
    const r = validateResearch(
      d,
      JSON.parse(fs.readFileSync("reports/probe-game.json", "utf8")),
    );
    expect(r.searchRequests).toBe(1);
    expect(r.cards.length).toBeGreaterThan(0);
  });
  it("rejects unrelated event identity", () => {
    const d = JSON.parse(fs.readFileSync("reports/search-probe.json", "utf8"));
    expect(() => validateResearch(d, { id: "wrong" } as any)).toThrow(
      "event mismatch",
    );
  });
  it("rejects SVG and malformed upload bytes", () => {
    expect(() => decodeImage(new TextEncoder().encode("<svg/>"))).toThrow();
    expect(() => decodeImage(new Uint8Array([137, 80, 78, 71]))).toThrow();
  });
  it("real provider image decodes within bounds", () => {
    const p = fs
      .readdirSync("reports")
      .find((x) => /^image-0-references\.(png|jpg)$/.test(x))!;
    const i = validateArtwork(fs.readFileSync("reports/" + p));
    expect(i.width).toBe(i.height);
    expect(i.width).toBeGreaterThanOrEqual(600);
  });
});
it("new product contract rejects a second photo and arbitrary URL fields", async () => {
  const { generationInputSchema } =
    await import("../packages/contracts/src/generation");
  const input = {
    gameId: "nfl:123",
    favoriteTeamId: "espn:football:21",
    referenceIds: [crypto.randomUUID(), crypto.randomUUID()],
  };
  expect(generationInputSchema.safeParse(input).success).toBe(false);
  expect(
    generationInputSchema.safeParse({
      ...input,
      referenceIds: [],
      url: "https://example.com",
    }).success,
  ).toBe(false);
});
it("research omits cited pages for another meeting of the same teams", () => {
  const d = JSON.parse(fs.readFileSync("reports/search-probe.json", "utf8")),
    g = JSON.parse(fs.readFileSync("reports/probe-game.json", "utf8"));
  const content = JSON.parse(d.choices[0].message.content);
  const wrong = "https://www.espn.com/nfl/recap/_/gameId/999";
  content.sources = [{ url: wrong, publishedAt: g.date }];
  content.cards = [
    { title: "Wrong matchup", body: "Prior game", sourceUrls: [wrong] },
  ];
  d.choices[0].message.content = JSON.stringify(content);
  d.choices[0].message.annotations = [
    {
      type: "url_citation",
      url_citation: {
        url: wrong,
        title: g.away.displayName + " " + g.home.displayName,
        content: "Old game",
      },
    },
  ];
  expect(validateResearch(d, g).cards).toHaveLength(0);
});
