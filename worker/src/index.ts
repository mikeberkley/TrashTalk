import { publicPage, launchPage } from "./legal";
import { sharedGame } from "./providers/cache";
import { refreshLeague } from "./catalog";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { type Env, sql, hash, now, uid } from "./env";
import { leagues } from "../../packages/contracts/src/leagues";
import { base, getJson, normalize, espn } from "./providers/espn";
import { newSession, verifyGoogle, linkGoogle } from "./auth";
import { checkout, webhook } from "./billing";
import { normalizeUpload } from "./jobs/media";
import { runJob, reconcile } from "./jobs/pipeline";
export { Coordinator } from "./Coordinator";
const app = new Hono<{
  Bindings: Env;
  Variables: { owner: string; csrf: string };
}>();
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
  maxAge: 30 * 86400,
};
app.onError((e, c) => {
  console.error("Request failed", e.name);
  return c.json({ error: e.message.slice(0, 240) }, 400);
});
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' data: blob:; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com https://checkout.stripe.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  if (c.env.ENVIRONMENT === "production" && c.env.PREVIEW_UNLIMITED === "true")
    return c.json({ error: "Invalid production configuration" }, 503);
  await next();
});
app.post("/api/billing/webhook", async (c) => {
  const body = await bounded(c.req.raw, 256 * 1024);
  await webhook(c.env, body, c.req.header("stripe-signature") || "");
  return c.json({ received: true });
});
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  let token = getCookie(c, "tt_session");
  let session = token
    ? await sql(
        c.env,
        "SELECT principal,csrf FROM sessions WHERE token_hash=? AND expires>?",
        await hash(token),
        now(),
      ).first<any>()
    : null;
  if (!session) {
    const signal = await hash(
      (c.req.header("CF-Connecting-IP") || "local") +
        new Date().toISOString().slice(0, 10),
    );
    if (!(await rate(c.env, "session:" + signal, "new-session", 200, 3600)))
      return c.json(
        { error: "Too many new sessions. Please try again later." },
        429,
      );
    const fresh = await newSession(c.env);
    session = { principal: fresh.owner, csrf: fresh.csrf };
    setCookie(c, "tt_session", fresh.token, cookieOptions);
  }
  c.set("owner", session.principal);
  c.set("csrf", session.csrf);
  if (!["GET", "HEAD"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (
      origin !== new URL(c.req.url).origin ||
      c.req.header("X-CSRF-Token") !== session.csrf
    )
      return c.json({ error: "Request security check failed" }, 403);
  }
  await next();
});
async function bounded(r: Request, max: number) {
  if (Number(r.headers.get("content-length")) > max)
    throw Error("Request too large");
  const reader = r.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw Error("Request too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let n = 0;
  for (const b of chunks) {
    bytes.set(b, n);
    n += b.length;
  }
  return new TextDecoder().decode(bytes);
}
const body = async (c: any) => JSON.parse(await bounded(c.req.raw, 16384));
app.get("/api/me", async (c) => {
  const owner = c.get("owner");
  const p = await sql(
    c.env,
    "SELECT google_sub FROM principals WHERE id=?",
    owner,
  ).first<any>();
  const balances = await sql(
    c.env,
    "SELECT pool,SUM(amount) AS n FROM ledger WHERE owner=? GROUP BY pool",
    owner,
  ).all<any>();
  return c.json({
    authenticated: !!p?.google_sub,
    csrf: c.get("csrf"),
    googleClientId: c.env.GOOGLE_CLIENT_ID || null,
    trial: Math.max(
      0,
      balances.results.find((x) => x.pool === "trial")?.n || 0,
    ),
    paid: Math.max(0, balances.results.find((x) => x.pool === "paid")?.n || 0),
    environment: c.env.ENVIRONMENT,
    paymentsReady:
      !!c.env.STRIPE_SECRET_KEY?.startsWith(
        c.env.ENVIRONMENT === "production" ? "sk_live_" : "sk_test_",
      ) && !!c.env.STRIPE_WEBHOOK_SECRET,
    activeJob:
      (
        await sql(
          c.env,
          "SELECT id FROM jobs WHERE owner=? AND status NOT IN ('complete','failed')",
          owner,
        ).first<any>()
      )?.id || null,
  });
});
app.get("/api/leagues", async (c) => {
  const enabled = await sql(
    c.env,
    "SELECT id FROM leagues WHERE enabled=1",
  ).all<any>();
  return c.json(
    leagues.filter((l) => enabled.results.some((x) => x.id === l.id)),
  );
});
app.get("/api/teams", async (c) => {
  const rows = await sql(
    c.env,
    "SELECT t.metadata,m.league FROM teams t JOIN memberships m ON m.team_id=t.id JOIN leagues l ON l.id=m.league WHERE l.enabled=1",
  ).all<any>();
  const teams = new Map<string, any>();
  for (const row of rows.results) {
    const t = JSON.parse(row.metadata);
    if (!teams.has(t.id))
      teams.set(t.id, {
        id: t.id,
        name: t.name,
        city: t.city,
        displayName: t.displayName,
        abbr: t.abbr,
        aliases: t.aliases,
        brandingUrl: `/branding/${t.id.split(":").slice(1).join("/")}/${t.version}`,
        leagueLabels: [],
      });
    teams
      .get(t.id)
      .leagueLabels.push(leagues.find((l) => l.id === row.league)?.label);
  }
  return c.json(
    [...teams.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    ),
  );
});
app.get("/api/favorites", async (c) =>
  c.json(
    (
      await sql(
        c.env,
        "SELECT team_id FROM favorites WHERE owner=?",
        c.get("owner"),
      ).all<any>()
    ).results.map((r) => r.team_id),
  ),
);
app.put("/api/favorites/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await sql(c.env, "SELECT id FROM teams WHERE id=?", id).first()))
    throw Error("Unsupported team");
  await sql(
    c.env,
    "INSERT OR IGNORE INTO favorites VALUES(?,?)",
    c.get("owner"),
    id,
  ).run();
  return c.json({ saved: true });
});
app.delete("/api/favorites/:id", async (c) => {
  await sql(
    c.env,
    "DELETE FROM favorites WHERE owner=? AND team_id=?",
    c.get("owner"),
    c.req.param("id"),
  ).run();
  return c.json({ saved: false });
});
app.get("/api/teams/:id/games", async (c) => {
  const id = c.req.param("id"),
    key = "upcoming:" + id;
  const membership = await sql(
    c.env,
    "SELECT m.league FROM memberships m JOIN leagues l ON l.id=m.league WHERE m.team_id=? AND l.enabled=1",
    id,
  ).all<any>();
  if (!membership.results.length) throw Error("Unsupported team");
  const cached = await sql(
    c.env,
    "SELECT value FROM cache WHERE key=? AND expires>?",
    key,
    now(),
  ).first<any>();
  let games: any[];
  if (cached) games = JSON.parse(cached.value);
  else {
    const year = new Date().getUTCFullYear();
    const results = await Promise.allSettled(
      membership.results.flatMap((row) => {
        const l = leagues.find((l) => l.id === row.league)!;
        return [year, year + 1].map(async (season) => {
          const d = await getJson(
            `${base}/${l.sport}/${l.path}/teams/${id.split(":").pop()}/schedule?season=${season}`,
          );
          if (!Array.isArray(d.events)) throw Error("Schedule unavailable");
          return d.events.map((e: any) => normalize(e, l));
        });
      }),
    );
    if (results.every((r) => r.status === "rejected"))
      throw Error("Schedule unavailable. Please try again.");
    games = [
      ...new Map(
        results
          .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
          .filter(
            (g) =>
              [g.away.id, g.home.id].includes(id) &&
              (g.status === "live" ||
                (g.status === "scheduled" && Date.parse(g.date) >= Date.now())),
          )
          .map((g) => [g.id, g]),
      ).values(),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
    await sql(
      c.env,
      "INSERT OR REPLACE INTO cache VALUES(?,?,?)",
      key,
      JSON.stringify(games),
      now() + 120,
    ).run();
  }
  return c.json(await Promise.all(games.map((g) => withBranding(c.env, g))));
});
// Compatibility for already-open clients: game selection never starts LLM research.
app.post("/api/games/:id/research", (c) =>
  c.json({ started: false, source: "ESPN scoreboard at generation" }),
);
app.get("/api/games/:id", async (c) =>
  c.json(await withBranding(c.env, await sharedGame(c.env, c.req.param("id")))),
);
app.post("/api/uploads", async (c) => {
  if (!(await rate(c.env, c.get("owner"), "upload", 30, 3600)))
    return c.json(
      { error: "Upload limit reached. Please try again later." },
      429,
    );
  if (Number(c.req.header("Content-Length")) > 10 * 1024 * 1024)
    throw Error("Maximum photo size is 10 MiB");
  const count = await sql(
    c.env,
    "SELECT COUNT(*) AS n FROM uploads WHERE owner=? AND attached_at IS NULL",
    c.get("owner"),
  ).first<any>();
  if (count.n >= 8) throw Error("Remove unused photos before uploading more");
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw Error("No image");
  let len = 0;
  const parts = [];
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    len += r.value.length;
    if (len > 10 * 1024 * 1024) {
      await reader.cancel();
      throw Error("Maximum photo size is 10 MiB");
    }
    parts.push(r.value);
  }
  const bytes = new Uint8Array(len);
  let pos = 0;
  for (const p of parts) {
    bytes.set(p, pos);
    pos += p.length;
  }
  const normalized = await normalizeUpload(c.env, bytes),
    id = uid(),
    key = "uploads/" + id;
  await c.env.MEDIA.put(key, normalized, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await sql(
    c.env,
    "INSERT INTO uploads VALUES(?,?,?,?,?,?,NULL)",
    id,
    c.get("owner"),
    key,
    await hash(normalized),
    "image/jpeg",
    now(),
  ).run();
  return c.json({ id, url: "/api/uploads/" + id }, 201);
});
app.get("/api/uploads/:id", async (c) => {
  const u = await sql(
    c.env,
    "SELECT object_key FROM uploads WHERE id=? AND owner=?",
    c.req.param("id"),
    c.get("owner"),
  ).first<any>();
  if (!u) return c.notFound();
  const obj = await c.env.MEDIA.get(u.object_key);
  return obj
    ? new Response(obj.body, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, no-store",
        },
      })
    : c.notFound();
});
app.delete("/api/uploads/:id", async (c) => {
  const u = await sql(
    c.env,
    "DELETE FROM uploads WHERE id=? AND owner=? AND attached_at IS NULL RETURNING object_key",
    c.req.param("id"),
    c.get("owner"),
  ).first<any>();
  if (!u)
    return c.json({ error: "Photo is missing or attached to an image" }, 409);
  await c.env.MEDIA.delete(u.object_key);
  return c.json({ ok: true });
});
app.post("/api/generations", async (c) => {
  const input = await body(c);
  const r = await c.env.COORDINATOR.get(
    c.env.COORDINATOR.idFromName("principal:" + c.get("owner")),
  ).fetch("https://internal/admit", {
    method: "POST",
    body: JSON.stringify({
      owner: c.get("owner"),
      input,
      idempotency: c.req.header("Idempotency-Key"),
    }),
  });
  return c.json(await r.json(), r.ok ? 202 : 409);
});
app.post("/api/generations/:id/retry", async (c) => {
  const j = await sql(
    c.env,
    "SELECT input FROM jobs WHERE id=? AND owner=?",
    c.req.param("id"),
    c.get("owner"),
  ).first<any>();
  if (!j) return c.notFound();
  const input = JSON.parse(j.input);
  const r = await c.env.COORDINATOR.get(
    c.env.COORDINATOR.idFromName("principal:" + c.get("owner")),
  ).fetch("https://internal/admit", {
    method: "POST",
    body: JSON.stringify({
      owner: c.get("owner"),
      input: {
        gameId: input.gameId,
        favoriteTeamId: input.favoriteTeamId,
        includeWord: input.includeWord,
        referenceIds: input.referenceIds,
      },
      idempotency: c.req.header("Idempotency-Key"),
      retryOf: c.req.param("id"),
    }),
  });
  return c.json(await r.json(), r.ok ? 202 : 409);
});
function publicJob(j: any) {
  const input = JSON.parse(j.input);
  const context = j.context ? JSON.parse(j.context) : null;
  return {
    id: j.id,
    gameId: input.gameId,
    favoriteTeamId: input.favoriteTeamId,
    includeWord: input.includeWord,
    shareToken: j.share_token || null,
    shareTitle: context
      ? `${context.away.displayName} vs ${context.home.displayName}`
      : null,
    status: j.status,
    error: j.error,
    createdAt: j.created_at,
    text: j.caption ? JSON.parse(j.caption).text : null,
    url: j.status === "complete" ? "/api/generations/" + j.id + "/image" : null,
    limitation: j.context ? JSON.parse(j.context).research?.limitation : null,
  };
}
app.get("/api/generations/:id", async (c) => {
  const j = await sql(
    c.env,
    "SELECT jobs.*,shares.token AS share_token FROM jobs LEFT JOIN shares ON shares.job_id=jobs.id WHERE jobs.id=? AND owner=? AND jobs.deleted_at IS NULL",
    c.req.param("id"),
    c.get("owner"),
  ).first<any>();
  return j ? c.json(publicJob(j)) : c.notFound();
});
app.get("/api/generations/:id/image", async (c) => {
  const j = await sql(
    c.env,
    "SELECT artwork FROM jobs WHERE id=? AND owner=? AND status='complete' AND deleted_at IS NULL",
    c.req.param("id"),
    c.get("owner"),
  ).first<any>();
  if (!j) return c.notFound();
  const o = await c.env.MEDIA.get(j.artwork);
  return o
    ? new Response(o.body, {
        headers: {
          "Content-Type": o.httpMetadata?.contentType || "image/png",
          "Cache-Control": "private, no-store",
        },
      })
    : c.notFound();
});
app.delete("/api/generations/:id", async (c) => {
  const id = c.req.param("id"),
    owner = c.get("owner");
  const j = await sql(
    c.env,
    "SELECT artwork FROM jobs WHERE id=? AND owner=? AND status='complete' AND deleted_at IS NULL",
    id,
    owner,
  ).first<any>();
  if (!j) return c.notFound();
  await c.env.DB.batch([
    sql(
      c.env,
      "UPDATE jobs SET deleted_at=? WHERE id=? AND owner=? AND status='complete'",
      now(),
      id,
      owner,
    ),
  ]);
  if (j.artwork)
    c.executionCtx.waitUntil(
      c.env.MEDIA.delete(j.artwork)
        .then(() =>
          sql(
            c.env,
            "UPDATE jobs SET artwork=NULL WHERE id=? AND deleted_at IS NOT NULL",
            id,
          ).run(),
        )
        .catch(() => {}),
    );
  return c.json({ deleted: true });
});
app.get("/api/my-images", async (c) => {
  const before = Number(c.req.query("before") || now() + 1);
  const rows = await sql(
    c.env,
    "SELECT jobs.*,shares.token AS share_token FROM jobs LEFT JOIN shares ON shares.job_id=jobs.id WHERE owner=? AND status='complete' AND jobs.deleted_at IS NULL AND (jobs.created_at<? OR (jobs.created_at=? AND jobs.id<?)) ORDER BY jobs.created_at DESC,jobs.id DESC LIMIT 30",
    c.get("owner"),
    before,
    before,
    c.req.query("beforeId") || "",
  ).all<any>();
  return c.json(rows.results.map(publicJob));
});
app.get("/api/billing/purchases/:session", async (c) => {
  const purchase = await sql(
    c.env,
    "SELECT p.status,p.amount,p.credits,EXISTS(SELECT 1 FROM ledger l WHERE l.business_key='purchase:'||p.session_id AND l.owner=p.owner AND l.kind='grant') AS credited FROM purchases p WHERE p.session_id=? AND p.owner=?",
    c.req.param("session"),
    c.get("owner"),
  ).first();
  return purchase ? c.json(purchase) : c.notFound();
});
app.get("/api/billing/purchases", async (c) =>
  c.json(
    (
      await sql(
        c.env,
        "SELECT session_id,status,amount,credits,created_at FROM purchases WHERE owner=? ORDER BY created_at DESC LIMIT 50",
        c.get("owner"),
      ).all()
    ).results,
  ),
);
app.post("/api/generations/:id/share", async (c) => {
  const id = c.req.param("id");
  if (
    !(await sql(
      c.env,
      "SELECT id FROM jobs WHERE id=? AND owner=? AND status='complete' AND deleted_at IS NULL",
      id,
      c.get("owner"),
    ).first())
  )
    return c.notFound();
  await sql(
    c.env,
    "INSERT INTO shares(token,job_id,created_at,published) VALUES(?,?,?,1) ON CONFLICT(job_id) DO UPDATE SET published=1",
    uid().replaceAll("-", ""),
    id,
    now(),
  ).run();
  const s = await sql(
    c.env,
    "SELECT token FROM shares WHERE job_id=?",
    id,
  ).first<any>();
  return c.json({ url: c.env.ORIGIN + "/m/" + s.token });
});
app.post("/api/auth/google", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID)
    throw Error("Google sign-in needs configuration");
  const b = await body(c),
    sub = await verifyGoogle(b.credential, c.env.GOOGLE_CLIENT_ID),
    linked = await c.env.COORDINATOR.get(
      c.env.COORDINATOR.idFromName("google:" + (await hash(sub))),
    ).fetch("https://internal/link", {
      method: "POST",
      body: JSON.stringify({ owner: c.get("owner"), sub }),
    });
  if (!linked.ok) throw Error(((await linked.json()) as any).error);
  const owner = ((await linked.json()) as any).owner;
  const fresh = await newSession(c.env, owner);
  const old = getCookie(c, "tt_session");
  if (old)
    await sql(
      c.env,
      "DELETE FROM sessions WHERE token_hash=?",
      await hash(old),
    ).run();
  setCookie(c, "tt_session", fresh.token, cookieOptions);
  return c.json({ ok: true });
});
app.post("/api/auth/logout", async (c) => {
  const t = getCookie(c, "tt_session");
  if (t)
    await sql(
      c.env,
      "DELETE FROM sessions WHERE token_hash=?",
      await hash(t),
    ).run();
  const fresh = await newSession(c.env, undefined, 0);
  setCookie(c, "tt_session", fresh.token, cookieOptions);
  return c.json({ ok: true });
});
app.post("/api/billing/checkout", async (c) =>
  c.json({
    url: await checkout(
      c.env,
      c.get("owner"),
      c.req.header("Idempotency-Key") || "",
    ),
  }),
);
app.get("/branding/league/:id", async (c) => {
  const r = await sql(
    c.env,
    "SELECT object_key FROM league_assets WHERE league=?",
    c.req.param("id"),
  ).first<any>();
  if (!r) return c.notFound();
  const obj = await c.env.MEDIA.get(r.object_key);
  return obj
    ? new Response(obj.body, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public,max-age=86400",
        },
      })
    : c.notFound();
});
app.get("/branding/:sport/:team/:version", async (c) => {
  const { sport, team, version } = c.req.param();
  const row = await sql(
    c.env,
    "SELECT logo_key FROM team_versions WHERE team_id=? AND version=?",
    `espn:${sport}:${team}`,
    version,
  ).first<any>();
  if (!row) return c.notFound();
  const o = await c.env.MEDIA.get(row.logo_key);
  return o
    ? new Response(o.body, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public,max-age=31536000,immutable",
        },
      })
    : c.notFound();
});
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ]!,
  );
app.get("/m/:token/image", async (c) => {
  const j = await sql(
    c.env,
    "SELECT j.artwork FROM shares s JOIN jobs j ON j.id=s.job_id WHERE s.token=? AND s.published=1 AND j.status='complete' AND j.deleted_at IS NULL",
    c.req.param("token"),
  ).first<any>();
  if (!j) return c.notFound();
  const o = await c.env.MEDIA.get(j.artwork);
  return o
    ? new Response(o.body, {
        headers: {
          "Content-Type": o.httpMetadata?.contentType || "image/png",
          "Cache-Control": "public,max-age=31536000,immutable",
        },
      })
    : c.notFound();
});
app.get("/m/:token", async (c) => {
  const j = await sql(
    c.env,
    "SELECT j.caption,j.context,j.deleted_at,j.status,s.published FROM shares s JOIN jobs j ON j.id=s.job_id WHERE s.token=?",
    c.req.param("token"),
  ).first<any>();
  // Missing tokens also cover shares removed by the previous deletion behavior.
  if (!j || j.deleted_at != null) {
    c.header("Cache-Control", "no-store");
    return c.redirect("/", 302);
  }
  if (!j.published || j.status !== "complete") return c.notFound();
  const ctx = JSON.parse(j.context),
    caption = JSON.parse(j.caption).text,
    title = escape(`${ctx.away.displayName} vs ${ctx.home.displayName}`),
    url = escape(c.env.ORIGIN + "/m/" + c.req.param("token"));
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:image" content="${url}/image"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:image" content="${url}/image"><link rel="canonical" href="${url}"><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/share.css"><script src="/share.js" defer></script></head><body><main><img src="${url}/image" alt="${escape(caption)}"><button id="share" type="button">↗ Share</button><a href="/">Make your own</a></main></body></html>`,
  );
});
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" || request.method === "HEAD") {
      const legal = publicPage(path);
      if (legal)
        return request.method === "HEAD" ? new Response(null, legal) : legal;
      if (
        path === "/" &&
        env.ENVIRONMENT === "production" &&
        env.LAUNCH_HOLD === "true"
      ) {
        const landing = launchPage();
        return request.method === "HEAD"
          ? new Response(null, landing)
          : landing;
      }
    }
    if (
      env.ENVIRONMENT === "production" &&
      env.LAUNCH_HOLD === "true" &&
      new URL(request.url).pathname !== "/api/billing/webhook"
    ) {
      const headers = {
        "Cache-Control": "no-store",
        "Retry-After": "3600",
        "X-Robots-Tag": "noindex, nofollow",
      };
      if (new URL(request.url).pathname.startsWith("/api/"))
        return Response.json(
          { error: "TrashTalk is preparing to launch." },
          { status: 503, headers },
        );
      return new Response(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TrashTalk — Coming soon</title><body style="background:#101318;color:#f5f5f5;font:20px system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>TrashTalk</h1><p>We’re getting ready for kickoff.</p><p>Check back soon to make your own sports memes.</p></body></html>',
        {
          status: 503,
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }
    return app.fetch(request, env, ctx);
  },
  async queue(
    batch: MessageBatch<{ id: string; catalog?: boolean }>,
    env: Env,
  ) {
    for (const m of batch.messages) {
      try {
        if (m.body.catalog) await refreshLeague(env, m.body.id);
        else await runJob(env, m.body.id);
        m.ack();
      } catch {
        m.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(reconcile(env));
    if (event.cron === "0 8 * * *") ctx.waitUntil(checkCatalog(env));
  },
};
async function checkCatalog(env: Env) {
  for (const l of leagues) await env.JOBS.send({ id: l.id, catalog: true });
}

async function rate(
  env: Env,
  owner: string,
  kind: string,
  max: number,
  window: number,
) {
  const r = await env.COORDINATOR.get(
    env.COORDINATOR.idFromName("rate:" + owner),
  ).fetch("https://internal/limit", {
    method: "POST",
    body: JSON.stringify({ kind, max, window }),
  });
  return ((await r.json()) as any).allowed;
}
async function withBranding(env: Env, g: any) {
  for (const side of ["away", "home"]) {
    const t = await sql(
      env,
      "SELECT metadata FROM teams WHERE id=?",
      g[side].id,
    ).first<{ metadata: string }>();
    if (t) {
      const m = JSON.parse(t.metadata);
      g[side].brandingUrl =
        "/branding/" + m.id.split(":").slice(1).join("/") + "/" + m.version;
    }
  }
  return g;
}
