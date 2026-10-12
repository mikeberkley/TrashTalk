import fs from "node:fs/promises";
import os from "node:os";
const config = await fs.readFile(
  os.homedir() + "/.wrangler/config/default.toml",
  "utf8",
);
const token = config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!token) throw Error("Cloudflare login required");
export const account = "74088836dff42e8f84630c2a7a51a4aa";
export async function cf(path: string, init: RequestInit = {}) {
  const r = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" + account + path,
    { ...init, headers: { Authorization: "Bearer " + token, ...init.headers } },
  );
  if (!r.ok) throw Error("Cloudflare API " + r.status + " " + path);
  return r;
}
