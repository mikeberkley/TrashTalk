import {
  captionInput,
  scoreContext,
} from "../../../packages/trash-talk/src/game-context";
import { leagueById } from "../../../packages/contracts/src/leagues";
import { sharedGame } from "../providers/cache";
import { z } from "zod";
import { type Env, sql, now, hash, uid } from "../env";
import { espn } from "../providers/espn";
import { openrouter } from "../research";
import {
  captionPrompt,
  captionModel,
  imageModel,
  imageRequest,
  PROMPT_VERSION,
} from "../../../packages/trash-talk/src/prompts";
import { captionIncludesWord } from "../../../packages/trash-talk/src/include-word";
import { loadLogo, loadPinnedTeams } from "./preparation";
import { GenerationTiming } from "./timing";
import { recentCaptions } from "./recent-captions";
import { validateArtwork, dataUrl } from "./media";
export const phraseSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine((v) => v.split(/\s+/).length <= 15),
  visual: z.string().trim().min(1).max(1000),
  theme: z.string().trim().min(1).max(160).optional(),
});
class InvalidStoredArtwork extends Error {}
export async function deleteJobUploads(env: Env, id: string) {
  const job = await sql(
    env,
    "SELECT owner,input FROM jobs WHERE id=?",
    id,
  ).first<any>();
  if (!job) throw Error("Job missing during photo cleanup");
  const refs = JSON.parse(job.input).references || [];
  for (const ref of refs) {
    const upload = await sql(
      env,
      "SELECT object_key FROM uploads WHERE id=? AND owner=?",
      ref.id,
      job.owner,
    ).first<any>();
    const key = upload?.object_key || ref.key;
    if (typeof key !== "string" || !key.startsWith("uploads/"))
      throw Error("Invalid upload cleanup key");
    await env.MEDIA.delete(key);
    if (await env.MEDIA.head(key))
      throw Error("Uploaded photo deletion not confirmed");
    await sql(
      env,
      "DELETE FROM uploads WHERE id=? AND owner=?",
      ref.id,
      job.owner,
    ).run();
  }
}
export async function finalize(env: Env, id: string, key: string) {
  const object = await env.MEDIA.get(key);
  if (!object) throw Error("Stored artwork missing");
  try {
    validateArtwork(new Uint8Array(await object.arrayBuffer()));
  } catch {
    throw new InvalidStoredArtwork("Stored artwork failed validation");
  }
  await deleteJobUploads(env, id);
  await env.DB.batch([
    sql(
      env,
      "INSERT OR IGNORE INTO shares(token,job_id,created_at,published) VALUES(?,?,?,0)",
      uid().replaceAll("-", ""),
      id,
      now(),
    ),
    sql(
      env,
      "UPDATE jobs SET artwork=?,status='complete',lease_until=0,updated_at=?,error=NULL WHERE id=? AND status!='complete'",
      key,
      now(),
      id,
    ),
    sql(
      env,
      "UPDATE reservations SET state='captured' WHERE job_id=? AND state='reserved'",
      id,
    ),
  ]);
}
export async function fail(env: Env, id: string, error: string) {
  await env.DB.batch([
    sql(
      env,
      "UPDATE jobs SET status='failed',error=?,lease_until=0,updated_at=? WHERE id=? AND status!='complete'",
      error,
      now(),
      id,
    ),
    sql(
      env,
      "UPDATE reservations SET state='released' WHERE job_id=? AND state='reserved' AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND status='failed')",
      id,
      id,
    ),
  ]);
}
export async function runJob(env: Env, id: string) {
  const lock = await sql(
    env,
    "UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND status NOT IN ('complete','failed') AND lease_until<? RETURNING *",
    now() + 300,
    now(),
    id,
    now(),
  ).first<any>();
  if (!lock) return;
  const timing = new GenerationTiming(lock.created_at);
  let outcome = "failed";
  const logos: Record<string, string> = {};
  let history: Awaited<ReturnType<typeof recentCaptions>> = [];
  const input = JSON.parse(lock.input),
    imageKey = `artwork/${id}`;
  try {
    if (await env.MEDIA.head(imageKey)) {
      timing.next("recovery");
      outcome = (await recoverStored(env, id, imageKey))
        ? "recovered"
        : "failed";
      return;
    }
    // A prior process may have sent a paid call. Never repeat it on automatic redelivery.
    if (lock.call_started) {
      await fail(
        env,
        id,
        "Provider outcome uncertain. No automatic paid retry. Check the result, then explicitly retry.",
      );
      return;
    }
    let context = lock.context ? JSON.parse(lock.context) : null;
    let phrase = lock.caption ? JSON.parse(lock.caption) : null;
    if (context?.promptVersion !== PROMPT_VERSION || !phrase) {
      context = null;
      phrase = null;
    }
    if (!context) {
      await sql(
        env,
        "UPDATE jobs SET status='researching',updated_at=? WHERE id=?",
        now(),
        id,
      ).run();
      timing.next("preparation");
      const [g, loaded, recent] = await Promise.all([
        sharedGame(env, input.gameId, true).catch(() => null),
        loadPinnedTeams(env, input.teams),
        recentCaptions(env, id),
      ]);
      history = recent;
      const teams: any = {};
      for (const side of ["away", "home"]) {
        teams[side] = loaded[side].team;
        logos[side] = loaded[side].logo;
      }
      const league = leagueById(input.gameId.split(":")[0]);
      if (
        ![teams.home.id, teams.away.id].includes(input.favoriteTeamId) ||
        (g && (g.home.id !== teams.home.id || g.away.id !== teams.away.id))
      )
        throw Error("Game participants changed; choose the game again");
      context = {
        ...g,
        ...teams,
        id: input.gameId,
        league: league.id,
        leagueLabel: league.label,
        sport: league.sport,
        favorite: teams.home.id === input.favoriteTeamId ? "home" : "away",
        gameContext: scoreContext(g),
        promptVersion: PROMPT_VERSION,
      };
      context.identity = await hash(
        JSON.stringify([
          input.gameId,
          input.favoriteTeamId,
          input.includeWord,
          input.references,
          input.teams,
          PROMPT_VERSION,
          context.gameContext,
        ]),
      );
      await sql(
        env,
        "UPDATE jobs SET context=? WHERE id=?",
        JSON.stringify(context),
        id,
      ).run();
    }
    if (!phrase) {
      await sql(
        env,
        "UPDATE jobs SET status='captioning',call_started='caption',updated_at=? WHERE id=?",
        now(),
        id,
      ).run();
      const clean = captionInput(context);
      timing.next("captionProvider");
      const d = await openrouter(
        env,
        "chat/completions",
        {
          model: captionModel,
          reasoning: { effort: "low" },
          messages: [
            {
              role: "system",
              content: captionPrompt(
                input.includeWord,
                context.league === "nfl",
              ),
            },
            {
              role: "user",
              content: JSON.stringify({
                ...clean,
                recentCaptions: history,
              }),
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
        },
        45000,
        id,
      );
      timing.next("captionValidationAndSave");
      phrase = phraseSchema.parse(JSON.parse(d.choices[0].message.content));
      if (
        input.includeWord &&
        !captionIncludesWord(phrase.text, input.includeWord)
      )
        throw Error("Caption omitted required word");
      await sql(
        env,
        "UPDATE jobs SET caption=?,call_started=NULL WHERE id=?",
        JSON.stringify(phrase),
        id,
      ).run();
    }
    timing.next("imagePreparation");
    const c = structuredClone(context);
    const [logoEntries, photos] = await Promise.all([
      Promise.all(
        ["away", "home"].map(
          async (side) =>
            [side, logos[side] || (await loadLogo(env, c[side]))] as const,
        ),
      ),
      Promise.all(
        input.references.map(async (ref: any) => {
          const obj = await env.MEDIA.get(ref.key);
          if (!obj)
            throw Error(
              "Reference expired. Upload it again to create a new image.",
            );
          const b = new Uint8Array(await obj.arrayBuffer());
          if ((await hash(b)) !== ref.hash)
            throw Error("Reference hash mismatch");
          return dataUrl(b, ref.mime);
        }),
      ),
    ]);
    for (const [side, logo] of logoEntries) c[side].logo = logo;
    await sql(
      env,
      "UPDATE jobs SET status='imaging',call_started='image',updated_at=? WHERE id=?",
      now(),
      id,
    ).run();
    timing.next("imageProvider");
    const d = await openrouter(
      env,
      "images",
      imageRequest(c, phrase, photos),
      120000,
      id,
    );
    timing.next("imageValidationAndStorage");
    const o = d.data?.[0];
    if (!o?.b64_json) throw Error("Provider returned no inline image");
    const bytes = Uint8Array.from(atob(o.b64_json), (x) => x.charCodeAt(0));
    const info = validateArtwork(bytes);
    await env.MEDIA.put(imageKey, bytes, {
      httpMetadata: { contentType: info.mime },
    });
    timing.next("finalization");
    await finalize(env, id, imageKey);
    outcome = "complete";
    await sql(
      env,
      "INSERT INTO audit(kind,object_id,detail,created_at) VALUES(?,?,?,?)",
      "generation",
      id,
      JSON.stringify({ usage: d.usage, referenceCount: 2 + photos.length }),
      now(),
    ).run();
  } catch (e) {
    if (await env.MEDIA.head(imageKey)) {
      timing.next("recovery");
      outcome = (await recoverStored(env, id, imageKey))
        ? "recovered"
        : "failed";
      return;
    }
    timing.next("failureFinalization");
    await fail(env, id, e instanceof Error ? e.message : "Generation failed");
  } finally {
    await timing.persist(env, id, outcome, {
      caption: captionModel,
      image: imageModel,
    });
  }
}
export async function reconcile(env: Env) {
  const { results } = await sql(
    env,
    "SELECT id,call_started,status,updated_at FROM jobs WHERE status NOT IN ('complete','failed') AND lease_until<? AND updated_at<? LIMIT 50",
    now(),
    now() - 300,
  ).all<any>();
  for (const j of results) {
    if (await env.MEDIA.head(`artwork/${j.id}`))
      await recoverStored(env, j.id, `artwork/${j.id}`);
    else if (j.call_started || j.updated_at < now() - 600)
      await fail(
        env,
        j.id,
        "Work expired or provider outcome uncertain. Explicit retry required.",
      );
    else await env.JOBS.send({ id: j.id });
  }
  const deleted = await sql(
    env,
    "SELECT id,artwork FROM jobs WHERE deleted_at IS NOT NULL AND artwork IS NOT NULL LIMIT 50",
  ).all<any>();
  for (const j of deleted.results) {
    await env.MEDIA.delete(j.artwork);
    await sql(
      env,
      "UPDATE jobs SET artwork=NULL WHERE id=? AND deleted_at IS NOT NULL",
      j.id,
    ).run();
  }
  // Backfill legacy completions and repair interrupted photo cleanup.
  const completed = await sql(
    env,
    `SELECT DISTINCT j.id FROM jobs j JOIN json_each(j.input,'$.references') r JOIN uploads u ON u.id=json_extract(r.value,'$.id') AND u.owner=j.owner WHERE j.status='complete' LIMIT 100`,
  ).all<any>();
  for (const j of completed.results) await deleteJobUploads(env, j.id);
  const expired = await sql(
    env,
    "SELECT id,object_key FROM uploads WHERE (attached_at IS NULL AND created_at<?) OR (attached_at IS NOT NULL AND attached_at<?) LIMIT 100",
    now() - 86400,
    now() - 7 * 86400,
  ).all<any>();
  for (const u of expired.results) {
    await env.MEDIA.delete(u.object_key);
    await sql(env, "DELETE FROM uploads WHERE id=?", u.id).run();
  }
  await sql(env, "DELETE FROM sessions WHERE expires<?", now()).run();
  await sql(env, "DELETE FROM cache WHERE expires<?", now()).run();
}

async function recoverStored(env: Env, id: string, key: string) {
  try {
    await finalize(env, id, key);
    return true;
  } catch (e) {
    if (e instanceof InvalidStoredArtwork) {
      await fail(env, id, e.message);
      return false;
    } else throw e;
  }
}
