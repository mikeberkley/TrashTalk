import {
  offer,
  offerPrice,
  generationInputSchema,
} from "../../packages/contracts/src/generation";
import { linkGoogle } from "./auth";
import { cachedGame, sharedGame } from "./providers/cache";
import { DurableObject } from "cloudflare:workers";
import { type Env, sql, now, hash, uid } from "./env";
import { espn } from "./providers/espn";
import { validateIncludeWord } from "../../packages/trash-talk/src/include-word";
import { cachedFeaturedGames } from "./providers/featured-games";
export class Coordinator extends DurableObject<Env> {
  async fetch(req: Request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const body: any = await req.json();
        const path = new URL(req.url).pathname;
        if (path === "/link")
          return Response.json({
            owner: await linkGoogle(this.env, body.owner, body.sub),
          });
        if (path === "/featured")
          return Response.json(await cachedFeaturedGames(this.env));
        if (path === "/facts")
          return Response.json(
            await cachedGame(this.env, body.id, body.fresh === true),
          );
        if (path === "/limit") {
          const key = "rate:" + body.kind;
          const old = await this.ctx.storage.get<{ n: number; until: number }>(
            key,
          );
          const next =
            old && old.until > now()
              ? { ...old, n: old.n + 1 }
              : { n: 1, until: now() + body.window };
          await this.ctx.storage.put(key, next);
          return Response.json({ allowed: next.n <= body.max });
        }
        if (path === "/admit") return Response.json(await this.admit(body));
        return new Response("Not found", { status: 404 });
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : "Request failed" },
          { status: 409 },
        );
      }
    });
  }
  async admit({ owner, input, idempotency, retryOf }: any) {
    input = generationInputSchema.parse(input);
    const env = this.env;
    if (env.PAUSE_GENERATION === "true")
      throw Error("Generation is temporarily paused");
    if (
      typeof idempotency !== "string" ||
      idempotency.length < 8 ||
      idempotency.length > 100
    )
      throw Error("An idempotency key is required");
    const inputHash = await hash(JSON.stringify(input));
    const prior = await sql(
      env,
      "SELECT id,input_hash FROM jobs WHERE owner=? AND idempotency=?",
      owner,
      idempotency,
    ).first<any>();
    if (prior) {
      if (prior.input_hash !== inputHash)
        throw Error("Idempotency key belongs to different input");
      return { id: prior.id };
    }
    if (
      await sql(
        env,
        "SELECT id FROM jobs WHERE owner=? AND status NOT IN ('complete','failed')",
        owner,
      ).first()
    )
      throw Error("You already have an active image");
    const w = validateIncludeWord(input.includeWord);
    if (w.error) throw Error(w.error);
    if (
      !Array.isArray(input.referenceIds) ||
      input.referenceIds.length > 1 ||
      new Set(input.referenceIds).size !== input.referenceIds.length
    )
      throw Error("Choose at most one reference photo");
    let pinned: any, old: any;
    if (retryOf) {
      old = await sql(
        env,
        "SELECT * FROM jobs WHERE id=? AND owner=? AND status='failed'",
        retryOf,
        owner,
      ).first<any>();
      if (!old || old.attempt >= 3) throw Error("Retry unavailable");
      pinned = JSON.parse(old.input);
      if (
        pinned.gameId !== input.gameId ||
        pinned.favoriteTeamId !== input.favoriteTeamId ||
        pinned.includeWord !== w.word
      )
        throw Error("Retry inputs changed");
    }
    const league = input.gameId?.split(":")[0];
    if (
      !(await sql(
        env,
        "SELECT id FROM leagues WHERE id=? AND enabled=1",
        league,
      ).first())
    )
      throw Error("League branding is not ready");
    if (!pinned) {
      const g = await sharedGame(env, input.gameId);
      if (g.status === "unavailable") throw Error("Game context unavailable");
      if (![g.home.id, g.away.id].includes(input.favoriteTeamId))
        throw Error("Choose a participating team to support");
      const teams: any = {};
      for (const side of ["away", "home"] as const) {
        const t = await sql(
          env,
          "SELECT metadata FROM teams WHERE id=?",
          g[side].id,
        ).first<{ metadata: string }>();
        if (!t) throw Error("Team branding unavailable");
        const m = JSON.parse(t.metadata);
        if (!m.primary || !m.secondary)
          throw Error("Verified team palette unavailable");
        teams[side] = {
          id: m.id,
          version: m.version,
          logoHash: m.logoHash,
          paletteHash: m.paletteHash,
        };
      }
      const references = [];
      for (const id of input.referenceIds) {
        const r = await sql(
          env,
          "SELECT * FROM uploads WHERE id=? AND owner=?",
          id,
          owner,
        ).first<any>();
        if (!r) throw Error("Photo missing or not owned by you");
        references.push({
          id: r.id,
          key: r.object_key,
          hash: r.hash,
          mime: r.mime,
        });
      }
      pinned = {
        gameId: input.gameId,
        favoriteTeamId: input.favoriteTeamId,
        includeWord: w.word,
        referenceIds: input.referenceIds,
        references,
        teams,
      };
    }
    const balance = await sql(
      env,
      "SELECT pool,SUM(amount) AS balance FROM ledger WHERE owner=? GROUP BY pool",
      owner,
    ).all<any>();
    const available = (pool: string) =>
      balance.results.find((x) => x.pool === pool)?.balance || 0;
    let pool =
      available("trial") > 0 ? "trial" : available("paid") > 0 ? "paid" : "";
    const bypass =
      env.ENVIRONMENT !== "production" && env.PREVIEW_UNLIMITED === "true";
    if (!pool && !bypass) {
      const p = await sql(
        env,
        "SELECT google_sub FROM principals WHERE id=?",
        owner,
      ).first<any>();
      throw Error(
        p?.google_sub
          ? `Buy ${offer.credits} image credits for ${offerPrice}.`
          : `Sign in with Google to buy ${offer.credits} image credits for ${offerPrice}.`,
      );
    }
    const id = uid();
    const statements = [];
    if (!pool) {
      pool = "test";
      statements.push(
        sql(
          env,
          "INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES(?,'grant',1,'test',?,?)",
          owner,
          "preview:" + id,
          now(),
        ),
      );
    }
    statements.push(
      sql(
        env,
        "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,retry_of,attempt,context,caption) VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?)",
        id,
        owner,
        idempotency,
        inputHash,
        JSON.stringify(pinned),
        now(),
        now(),
        retryOf || null,
        old ? old.attempt + 1 : 0,
        null,
        null,
      ),
      sql(
        env,
        "INSERT INTO reservations VALUES(?,?,?,'reserved')",
        id,
        owner,
        pool,
      ),
    );
    for (const ref of pinned.references)
      statements.push(
        sql(
          env,
          "UPDATE uploads SET attached_at=COALESCE(attached_at,?) WHERE id=? AND owner=?",
          now(),
          ref.id,
          owner,
        ),
      );
    await env.DB.batch(statements);
    try {
      await env.JOBS.send({ id });
    } catch {
      /* Cron republishes the durable queued job. */
    }
    return { id };
  }
}
