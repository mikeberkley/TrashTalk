import { it, expect, vi } from "vitest";
import fs from "node:fs";
import { testEnv } from "./harness";
import { finalize, runJob, reconcile, fail } from "../worker/src/jobs/pipeline";
import { newSession, linkGoogle, verifyGoogle } from "../worker/src/auth";
const seed = (
  db: any,
  id = "j",
  status = "imaging",
  call: string | null = "image",
) => {
  db.exec(
    "INSERT INTO principals(id,created_at) VALUES('a',0); INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES('a','grant',5,'trial','trial:a',0)",
  );
  db.prepare(
    "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,call_started) VALUES(?,'a','key','h','{}',?,0,0,?)",
  ).run(id, status, call);
  db.prepare("INSERT INTO reservations VALUES(?,'a','trial','reserved')").run(
    id,
  );
};
it("recovers stored image before repeating any paid call", async () => {
  const { env, db, objects } = testEnv();
  seed(db);
  objects.set("artwork/j", {
    bytes: fs.readFileSync("reports/image-0-references.jpg"),
  });
  const f = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw Error("No paid call allowed");
  });
  await runJob(env, "j");
  expect(
    (db.prepare("SELECT status FROM jobs WHERE id='j'").get() as any).status,
  ).toBe("complete");
  expect(
    (db.prepare("SELECT state FROM reservations").get() as any).state,
  ).toBe("captured");
  expect(f).not.toHaveBeenCalled();
  f.mockRestore();
});
it("ambiguous paid call expires without automatic retry and returns credit", async () => {
  const { env, db } = testEnv();
  seed(db);
  await runJob(env, "j");
  expect((db.prepare("SELECT status FROM jobs").get() as any).status).toBe(
    "failed",
  );
  expect(
    (db.prepare("SELECT state FROM reservations").get() as any).state,
  ).toBe("released");
});
it("complete redelivery does not charge again", async () => {
  const { env, db, objects } = testEnv();
  seed(db);
  objects.set("artwork/j", {
    bytes: fs.readFileSync("reports/image-0-references.jpg"),
  });
  await finalize(env, "j", "artwork/j");
  await runJob(env, "j");
  await finalize(env, "j", "artwork/j");
  expect(
    (
      db
        .prepare("SELECT COUNT(*) n FROM ledger WHERE kind='captured'")
        .get() as any
    ).n,
  ).toBe(1);
});
it("failure is idempotent", async () => {
  const { env, db } = testEnv();
  seed(db);
  await fail(env, "j", "test");
  await fail(env, "j", "test");
  expect((db.prepare("SELECT SUM(amount) n FROM ledger").get() as any).n).toBe(
    5,
  );
});
it("malformed persisted image cannot capture a credit", async () => {
  const { env, db, objects } = testEnv();
  seed(db);
  objects.set("artwork/j", { bytes: new Uint8Array([1, 2]) });
  await expect(finalize(env, "j", "artwork/j")).rejects.toThrow();
  expect(
    (db.prepare("SELECT state FROM reservations").get() as any).state,
  ).toBe("reserved");
});
it("rejects forged Google token", async () => {
  await expect(verifyGoogle("forged.jwt.token", "client")).rejects.toThrow();
});
it("account linkage does not grant another trial", async () => {
  const { env, db } = testEnv();
  const a = await newSession(env);
  await linkGoogle(env, a.owner, "google123");
  const b = await newSession(env);
  db.prepare(
    "INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES(?,'captured',0,'trial','consume:1',0)",
  ).run(b.owner);
  await linkGoogle(env, b.owner, "google123");
  await linkGoogle(env, b.owner, "google123");
  expect(
    (
      db
        .prepare("SELECT SUM(amount) n FROM ledger WHERE owner=?")
        .get(a.owner) as any
    ).n,
  ).toBe(4);
  expect(
    (
      db
        .prepare("SELECT principal FROM sessions WHERE csrf=?")
        .get(b.csrf) as any
    ).principal,
  ).toBe(a.owner);
});
it("refunded grant cannot be replenished by releasing reserved work", async () => {
  const { db } = testEnv();
  db.exec(
    "INSERT INTO principals(id,created_at) VALUES('a',0);INSERT INTO purchases VALUES('p','a','pi','paid',100,5,0);INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES('a','grant',5,'paid','purchase:p',0);INSERT INTO reservations VALUES('j','a','paid','reserved');UPDATE purchases SET status='review';INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES('a','reversal',-4,'paid','reversal:p',0);UPDATE reservations SET state='released' WHERE job_id='j'",
  );
  expect(
    (
      db
        .prepare("SELECT SUM(amount) n FROM ledger WHERE pool='paid'")
        .get() as any
    ).n,
  ).toBe(0);
});
it.each([
  "scheduled",
  "upcoming",
  "live",
  "outside-window",
  "final",
  "stale",
  "feed-failure",
])(
  "pins references and passes only eligible %s scoreboard context",
  async (scenario) => {
    const { env, db, objects } = testEnv();
    seed(db, "pinned", "queued", null);
    const source = JSON.parse(
      fs.readFileSync("reports/probe-game.json", "utf8"),
    );
    source.captionFacts = {
      players: [
        {
          side: "home",
          name: "Home Star",
          detail: "ESPN featured leader; game participation unconfirmed",
        },
        {
          side: "away",
          name: "Away Star",
          detail: "ESPN featured leader; game participation unconfirmed",
        },
      ],
      teams: [],
      moments: [],
    };
    source.status =
      scenario === "final"
        ? "final"
        : scenario === "scheduled" || scenario === "upcoming"
          ? "scheduled"
          : "live";
    source.date = new Date(
      Date.now() -
        (scenario === "outside-window" || scenario === "final" ? 5 : 1) *
          3600000,
    ).toISOString();
    if (scenario === "upcoming")
      source.date = new Date(Date.now() + 3600000).toISOString();
    source.capturedAt = new Date(
      Date.now() - (scenario === "stale" ? 60000 : 0),
    ).toISOString();
    const catalog = JSON.parse(
      fs.readFileSync("tests/fixtures/team-versions.json", "utf8"),
    );
    const pins: any = {};
    for (const side of ["away", "home"]) {
      const r = catalog.find((x: any) => x.metadata.id === source[side].id),
        m = r.metadata;
      pins[side] = { id: m.id, version: m.version };
      db.prepare("INSERT INTO team_versions VALUES(?,?,?,?,?,?)").run(
        m.id,
        m.version,
        m.logoKey,
        m.logoHash,
        m.paletteHash,
        JSON.stringify(m),
      );
      db.prepare("INSERT INTO teams VALUES(?,?,?)").run(
        m.id,
        JSON.stringify({ ...m, primary: "#ABCDEF", version: "new" }),
        "new",
      );
      objects.set(m.logoKey, { bytes: fs.readFileSync(r.pngPath) });
    }
    const input = {
      gameId: source.id,
      favoriteTeamId: source.away.id,
      includeWord: "",
      references: [],
      teams: pins,
    };
    db.prepare("UPDATE jobs SET input=? WHERE id=?").run(
      JSON.stringify(input),
      "pinned",
    );
    const factRequests: any[] = [];
    env.COORDINATOR = {
      idFromName: (x: string) => x,
      get: () => ({
        fetch: async (url: string, init: any) => {
          expect(url.endsWith("/facts")).toBe(true);
          factRequests.push(JSON.parse(init.body));
          if (scenario === "feed-failure")
            return new Response("Unavailable", { status: 503 });
          return Response.json(source);
        },
      }),
    };
    // Old saved captions/backstories must never leak into the new policy.
    db.prepare("UPDATE jobs SET context=?,caption=? WHERE id='pinned'").run(
      JSON.stringify({ promptVersion: "old", briefing: "old backstory" }),
      JSON.stringify({ text: "OLD CAPTION", visual: "OLD VISUAL" }),
    );
    const logoReadSpy = vi.spyOn(env.MEDIA, "get");
    const calls: any[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url: any, init: any) => {
        const payload = JSON.parse(init.body);
        calls.push(payload);
        return Response.json(
          String(url).endsWith("/images")
            ? {
                data: [
                  {
                    b64_json: fs
                      .readFileSync("reports/image-0-references.jpg")
                      .toString("base64"),
                  },
                ],
              }
            : {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        text: "Our team fights back with cosmic bananas",
                        visual: "Fictional space bananas",
                      }),
                    },
                  },
                ],
              },
        );
      });
    await runJob(env, "pinned");
    fetchSpy.mockRestore();
    expect(
      (db.prepare("SELECT status FROM jobs WHERE id='pinned'").get() as any)
        .status,
    ).toBe("complete");
    for (const side of ["away", "home"]) {
      expect(
        logoReadSpy.mock.calls.filter(([key]) => key === contextLogoKey(side)),
      ).toHaveLength(1);
    }
    function contextLogoKey(side: string) {
      return catalog.find((x: any) => x.metadata.id === source[side].id)
        .metadata.logoKey;
    }
    const timing = JSON.parse(
      (
        db
          .prepare(
            "SELECT detail FROM audit WHERE kind='generation_timing' AND object_id='pinned'",
          )
          .get() as any
      ).detail,
    );
    expect(timing.outcome).toBe("complete");
    for (const stage of [
      "preparation",
      "captionProvider",
      "imagePreparation",
      "imageProvider",
      "imageValidationAndStorage",
      "finalization",
    ]) {
      expect(timing.stagesMs[stage]).toBeGreaterThanOrEqual(0);
    }
    expect(timing.models.caption).toBe("x-ai/grok-4.3");
    expect(timing.models.captionReasoningEffort).toBe("none");
    expect(calls[0].reasoning).toEqual({ effort: "none" });
    expect(JSON.stringify(timing)).not.toContain("space bananas");
    expect(calls[1].prompt).not.toContain("#ABCDEF");
    expect(calls[1].input_references).toHaveLength(2);
    const context = JSON.parse(
      (db.prepare("SELECT context FROM jobs WHERE id='pinned'").get() as any)
        .context,
    );
    expect(context.backgroundCharacter).toBeTruthy();
    expect(calls[1].prompt).toContain(
      context.backgroundCharacter.toLowerCase(),
    );
    expect(calls[1].prompt).toContain("exactly one small background cameo");
    expect(factRequests).toEqual([{ id: source.id, fresh: true }]);
    const captionData = JSON.parse(calls[0].messages[1].content);
    for (const key of [
      "date",
      "status",
      "score",
      "revision",
      "recentMoment",
      "statistics",
      "stats",
      "moment",
      "research",
      "briefing",
    ])
      expect(captionData).not.toHaveProperty(key);
    if (["upcoming", "live", "final"].includes(scenario)) {
      expect(captionData.gameContext.facts.join(" ")).toContain("Home Star");
      expect(captionData.gameContext.facts.join(" ")).toContain("Away Star");
    }
    if (scenario === "live" || scenario === "final") {
      expect(captionData.gameContext.status).toBe(scenario);
      expect(captionData.gameContext).not.toHaveProperty("score");
      expect(captionData.gameContext.outcome).toBeTruthy();
      expect(captionData.jokeDirection).toBeTruthy();
      expect(captionData).not.toHaveProperty("recentCaptions");
      expect(context.gameContext.score).toEqual(source.score);
    } else if (scenario === "upcoming")
      expect(captionData.gameContext.status).toBe("upcoming");
    else expect(captionData).not.toHaveProperty("gameContext");
    expect(context.away.version).toBe(pins.away.version);
    expect(
      (db.prepare("SELECT published FROM shares").get() as any).published,
    ).toBe(0);
  },
);
it("corrupt stored artwork is terminal and releases credit on redelivery", async () => {
  const { env, db, objects } = testEnv();
  seed(db);
  objects.set("artwork/j", { bytes: new Uint8Array([1, 2]) });
  await runJob(env, "j");
  expect(
    (db.prepare("SELECT state FROM reservations").get() as any).state,
  ).toBe("released");
  expect((db.prepare("SELECT status FROM jobs").get() as any).status).toBe(
    "failed",
  );
});

it("deletes associated uploads before completion and preserves the generated meme and unrelated photos", async () => {
  const { env, db, objects } = testEnv();
  seed(db);
  const refs = [
    { id: "photo", key: "uploads/photo", hash: "h", mime: "image/jpeg" },
  ];
  db.prepare("UPDATE jobs SET input=? WHERE id='j'").run(
    JSON.stringify({ references: refs }),
  );
  db.exec(
    "INSERT INTO uploads VALUES('photo','a','uploads/photo','h','image/jpeg',0,0),('unused','a','uploads/unused','h','image/jpeg',0,NULL)",
  );
  objects.set("uploads/photo", { bytes: new Uint8Array([1]) });
  objects.set("uploads/unused", { bytes: new Uint8Array([1]) });
  objects.set("artwork/j", {
    bytes: fs.readFileSync("reports/image-0-references.jpg"),
  });
  const remove = env.MEDIA.delete;
  env.MEDIA.delete = async (key: string) => {
    expect(
      db.prepare("SELECT status FROM jobs WHERE id='j'").get()?.status,
    ).toBe("imaging");
    await remove(key);
  };
  await finalize(env, "j", "artwork/j");
  expect(objects.has("uploads/photo")).toBe(false);
  expect(objects.has("uploads/unused")).toBe(true);
  expect(objects.has("artwork/j")).toBe(true);
  expect(
    db.prepare("SELECT id FROM uploads WHERE id='photo'").get(),
  ).toBeUndefined();
  expect(db.prepare("SELECT status FROM jobs WHERE id='j'").get()?.status).toBe(
    "complete",
  );
  env.MEDIA.delete = remove;
  await finalize(env, "j", "artwork/j");
  expect(
    db.prepare("SELECT COUNT(*) n FROM ledger WHERE kind='captured'").get()?.n,
  ).toBe(1);
});
it("holds completion on deletion failure and recovers stored artwork without a paid call", async () => {
  const { env, db, objects } = testEnv();
  seed(db);
  db.prepare("UPDATE jobs SET input=? WHERE id='j'").run(
    JSON.stringify({ references: [{ id: "photo", key: "uploads/photo" }] }),
  );
  db.exec(
    "INSERT INTO uploads VALUES('photo','a','uploads/photo','h','image/jpeg',0,0)",
  );
  objects.set("uploads/photo", { bytes: new Uint8Array([1]) });
  objects.set("artwork/j", {
    bytes: fs.readFileSync("reports/image-0-references.jpg"),
  });
  const remove = env.MEDIA.delete;
  env.MEDIA.delete = async () => {
    throw Error("R2 unavailable");
  };
  await expect(finalize(env, "j", "artwork/j")).rejects.toThrow(
    "R2 unavailable",
  );
  expect(db.prepare("SELECT status FROM jobs WHERE id='j'").get()?.status).toBe(
    "imaging",
  );
  expect(db.prepare("SELECT state FROM reservations").get()?.state).toBe(
    "reserved",
  );
  expect(objects.has("uploads/photo")).toBe(true);
  env.MEDIA.delete = remove;
  const paid = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw Error("No paid call");
  });
  await runJob(env, "j");
  expect(paid).not.toHaveBeenCalled();
  paid.mockRestore();
  expect(objects.has("uploads/photo")).toBe(false);
  expect(db.prepare("SELECT status FROM jobs WHERE id='j'").get()?.status).toBe(
    "complete",
  );
});

it("scheduled cleanup removes legacy completed uploads while preserving failed-job retry photos", async () => {
  const { env, db, objects } = testEnv();
  seed(db, "j", "complete", null);
  db.prepare("UPDATE jobs SET input=? WHERE id='j'").run(
    JSON.stringify({ references: [{ id: "legacy", key: "uploads/legacy" }] }),
  );
  db.prepare(
    "INSERT INTO uploads VALUES('legacy','a','uploads/legacy','h','image/jpeg',?,?),('retry','a','uploads/retry','h','image/jpeg',?,?)",
  ).run(
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
    Math.floor(Date.now() / 1000),
  );
  objects.set("uploads/legacy", { bytes: new Uint8Array([1]) });
  objects.set("uploads/retry", { bytes: new Uint8Array([1]) });
  await reconcile(env);
  expect(objects.has("uploads/legacy")).toBe(false);
  expect(objects.has("uploads/retry")).toBe(true);
  expect(
    db.prepare("SELECT id FROM uploads WHERE id='legacy'").get(),
  ).toBeUndefined();
});
