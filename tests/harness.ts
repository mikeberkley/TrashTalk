import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
export function testEnv() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("worker/migrations").sort())
    db.exec(fs.readFileSync("worker/migrations/" + f, "utf8"));
  const objects = new Map<string, { bytes: Uint8Array; mime?: string }>();
  class Statement {
    args: any[] = [];
    constructor(public query: string) {}
    bind(...args: any[]) {
      this.args = args;
      return this;
    }
    async first() {
      return db.prepare(this.query).get(...this.args) ?? null;
    }
    async all() {
      return { results: db.prepare(this.query).all(...this.args) };
    }
    async run() {
      const r = db.prepare(this.query).run(...this.args);
      return { success: true, meta: { changes: Number(r.changes) } };
    }
  }
  const env: any = {
    DB: {
      prepare: (s: string) => new Statement(s),
      batch: async (stmts: Statement[]) => {
        db.exec("BEGIN");
        try {
          const out = [];
          for (const s of stmts) out.push(await s.run());
          db.exec("COMMIT");
          return out;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    },
    MEDIA: {
      get: async (key: string) => {
        const b = objects.get(key);
        return b
          ? {
              arrayBuffer: async () =>
                b.bytes.buffer.slice(
                  b.bytes.byteOffset,
                  b.bytes.byteOffset + b.bytes.byteLength,
                ),
              body: new Response(b.bytes as BodyInit).body,
              httpMetadata: { contentType: b.mime },
            }
          : null;
      },
      head: async (key: string) => (objects.has(key) ? {} : null),
      put: async (key: string, bytes: Uint8Array, opts: any) =>
        objects.set(key, { bytes, mime: opts?.httpMetadata?.contentType }),
      delete: async (key: string) => objects.delete(key),
    },
    JOBS: { send: async () => {} },
    ENVIRONMENT: "preview",
    ORIGIN: "http://localhost",
    OPENROUTER_API_KEY: "test",
  };
  return { env, db, objects };
}
