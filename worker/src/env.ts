export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  JOBS: Queue<{ id: string; catalog?: boolean }>;
  COORDINATOR: DurableObjectNamespace;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  ENVIRONMENT: string;
  ORIGIN: string;
  OPENROUTER_API_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  ADMIN_GOOGLE_SUB?: string;
  STATS_EXCLUDED_IPS?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PREVIEW_UNLIMITED?: string;
  PAUSE_GENERATION?: string;
  LAUNCH_HOLD?: string;
  STRICT_SEARCH?: string;
}
export const now = () => Math.floor(Date.now() / 1000);
export const uid = () => crypto.randomUUID();
export async function hash(x: string | ArrayBuffer | Uint8Array) {
  const a = typeof x === "string" ? new TextEncoder().encode(x) : x;
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", a as BufferSource)),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const sql = (e: Env, s: string, ...v: any[]) =>
  e.DB.prepare(s).bind(...v);
export function assertProduction(e: Env) {
  if (
    e.ENVIRONMENT === "production" &&
    (e.PREVIEW_UNLIMITED === "true" ||
      !e.STRIPE_SECRET_KEY?.startsWith("sk_live_"))
  )
    throw Error("Production billing configuration is not ready");
}
