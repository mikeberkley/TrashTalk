import { createRemoteJWKSet, jwtVerify } from "jose";
import { type Env, now, uid, hash, sql } from "../env";
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export async function verifyGoogle(token: string, audience: string) {
  const { payload } = await jwtVerify(token, jwks, {
    audience,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    algorithms: ["RS256"],
  });
  if (!payload.sub || !payload.exp) throw Error("Invalid Google token");
  return payload.sub;
}
export async function newSession(env: Env, principal?: string, trial = 5) {
  const token = uid() + uid(),
    csrf = uid(),
    owner = principal || uid(),
    stmts = [];
  if (!principal)
    stmts.push(
      sql(
        env,
        "INSERT INTO principals(id,created_at) VALUES(?,?)",
        owner,
        now(),
      ),
      sql(
        env,
        "INSERT INTO ledger(owner,kind,amount,pool,business_key,created_at) VALUES(?,'grant',?,'trial',?,?)",
        owner,
        trial,
        "trial:" + owner,
        now(),
      ),
    );
  stmts.push(
    sql(
      env,
      "INSERT INTO sessions VALUES(?,?,?,?)",
      await hash(token),
      owner,
      csrf,
      now() + 30 * 86400,
    ),
  );
  await env.DB.batch(stmts);
  return { token, csrf, owner };
}
export async function linkGoogle(env: Env, owner: string, sub: string) {
  if (
    await sql(
      env,
      "SELECT id FROM jobs WHERE owner=? AND status NOT IN ('complete','failed')",
      owner,
    ).first()
  )
    throw Error("Wait for your active image before signing in");
  const current = await sql(
    env,
    "SELECT google_sub FROM principals WHERE id=?",
    owner,
  ).first<any>();
  if (current?.google_sub && current.google_sub !== sub)
    throw Error("Log out before switching accounts");
  const account = await sql(
    env,
    "SELECT id FROM principals WHERE google_sub=?",
    sub,
  ).first<any>();
  if (!account) {
    await sql(
      env,
      "UPDATE principals SET google_sub=? WHERE id=? AND google_sub IS NULL",
      sub,
      owner,
    ).run();
    return owner;
  }
  if (account.id === owner) return owner;
  if (
    await sql(
      env,
      "SELECT id FROM jobs WHERE owner=? AND status NOT IN ('complete','failed')",
      account.id,
    ).first()
  )
    throw Error("An image is active on your account");
  const used = await sql(
    env,
    "SELECT COUNT(*) AS n FROM ledger WHERE owner=? AND pool='trial' AND kind='captured'",
    owner,
  ).first<any>();
  await env.DB.batch([
    sql(
      env,
      "INSERT OR IGNORE INTO ledger(owner,kind,amount,pool,business_key,created_at) SELECT ?,'link',-MIN(?,MAX(0,COALESCE(SUM(amount),0))),'trial',?,? FROM ledger WHERE owner=? AND pool='trial'",
      account.id,
      used?.n || 0,
      "link:" + owner,
      now(),
      account.id,
    ),
    sql(
      env,
      "INSERT OR IGNORE INTO favorites SELECT ?,team_id FROM favorites WHERE owner=?",
      account.id,
      owner,
    ),
    sql(env, "DELETE FROM favorites WHERE owner=?", owner),
    sql(env, "UPDATE jobs SET owner=? WHERE owner=?", account.id, owner),
    sql(env, "UPDATE uploads SET owner=? WHERE owner=?", account.id, owner),
    sql(
      env,
      "UPDATE principals SET merged_into=? WHERE id=?",
      account.id,
      owner,
    ),
    sql(
      env,
      "UPDATE sessions SET principal=? WHERE principal=?",
      account.id,
      owner,
    ),
  ]);
  return account.id;
}
