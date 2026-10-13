import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
import { testEnv } from "./harness";
it("paginates public memes by creation date with stable ties and excludes private, deleted and unfinished images", async () => {
  const { env, db } = testEnv();
  for (let i = 0; i < 25; i++) {
    db.prepare(
      "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,artwork,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      `j${String(i).padStart(2, "0")}`,
      "owner",
      `key${i}`,
      "hash",
      "{}",
      i === 24 ? "failed" : "complete",
      Math.floor(i / 2),
      0,
      "image",
      i === 23 ? 1 : null,
    );
    db.prepare("INSERT INTO shares VALUES(?,?,?,?)").run(
      `token${i}`,
      `j${String(i).padStart(2, "0")}`,
      100 - i,
      i === 22 ? 0 : 1,
    );
  }
  const get = async (cursor?: string) => {
    const response = await worker.fetch(
      new Request(
        `http://localhost/api/shared-memes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
      env,
      {} as any,
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<any>;
  };
  const first = await get();
  expect(first.items).toHaveLength(10);
  expect(first.items.map((j: any) => j.token)).toEqual(
    Array.from({ length: 10 }, (_, i) => `token${21 - i}`),
  );
  const second = await get(first.nextCursor);
  expect(second.items).toHaveLength(10);
  const third = await get(second.nextCursor);
  expect(third.items.map((j: any) => j.token)).toEqual(["token1", "token0"]);
  expect(third.nextCursor).toBeNull();
  expect(
    (
      await worker.fetch(
        new Request("http://localhost/api/shared-memes?cursor=bad"),
        env,
        {} as any,
      )
    ).status,
  ).toBe(400);
});
