import { afterEach, expect, it, vi } from "vitest";
import { openrouter } from "../worker/src/research";

afterEach(() => vi.restoreAllMocks());

const run = vi.fn().mockResolvedValue({ success: true });
const bind = vi.fn((..._values: any[]) => ({ run }));
const DB = { prepare: vi.fn(() => ({ bind })) };

it("logs correlated HTTP rejection details without request data or credentials", async () => {
  const prompt = 'Personal prompt with "quotes"';
  const photo = "data:image/jpeg;base64,PRIVATEPHOTO";
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: 400,
          message: "Content rejected",
          metadata: {
            provider_name: "xAI",
            raw: { prompt, photo, authorization: "Bearer sk-secret" },
          },
        },
      }),
      { status: 400, headers: { "x-request-id": "request-123" } },
    ),
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    openrouter(
      {
        DB,
        OPENROUTER_API_KEY: "sk-secret",
        ORIGIN: "https://example.com",
      } as any,
      "images",
      {
        model: "image-model",
        prompt,
        input_references: [{ image_url: { url: photo } }],
      },
      1000,
      "job-123",
    ),
  ).rejects.toThrow("OpenRouter images HTTP 400");
  const event = JSON.parse(log.mock.calls[0][0]);
  expect(event).toMatchObject({
    event: "openrouter_error",
    status: 400,
    jobId: "job-123",
    requestId: "request-123",
    model: "image-model",
  });
  expect(event.detail).toContain("Content rejected");
  expect(event.detail).toContain("xAI");
  expect(event.detail).not.toContain("Personal prompt");
  expect(event.detail).not.toContain("PRIVATEPHOTO");
  expect(event.detail).not.toContain("sk-secret");
  expect(bind).toHaveBeenLastCalledWith(
    "provider_error",
    "job-123",
    JSON.stringify(event),
    expect.any(Number),
  );
});

it("logs errors inside successful HTTP responses and bounds non-JSON error bodies", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const env = {
    OPENROUTER_API_KEY: "secret",
    ORIGIN: "https://example.com",
  } as any;
  fetch.mockResolvedValueOnce(
    Response.json({ error: { message: "Upstream rejected", code: 400 } }),
  );
  await expect(
    openrouter(env, "images", { model: "image-model" }, 1000),
  ).rejects.toThrow("Provider returned an error");
  expect(JSON.parse(log.mock.calls[0][0]).detail).toContain(
    "Upstream rejected",
  );
  fetch.mockResolvedValueOnce(
    new Response("Bad gateway " + "x".repeat(6000), { status: 502 }),
  );
  await expect(openrouter(env, "images", {}, 1000)).rejects.toThrow("HTTP 502");
  expect(JSON.parse(log.mock.calls[1][0]).detail).toHaveLength(4096);
});

it("persists transport failures for the job without leaking credentials", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Bearer sk-secret connection failed"),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    openrouter(
      { DB, OPENROUTER_API_KEY: "sk-secret" } as any,
      "images",
      { model: "image-model" },
      1000,
      "transport-job",
    ),
  ).rejects.toThrow("connection failed");
  const event = JSON.parse(bind.mock.calls.at(-1)![2] as string);
  expect(event.status).toBeNull();
  expect(event.detail).toContain("connection failed");
  expect(event.detail).not.toContain("sk-secret");
});

it("retains provider diagnostics in D1 and returns them through admin stats", async () => {
  const { testEnv } = await import("./harness");
  const { statDetails } = await import("../worker/src/stats");
  const { env, db } = testEnv();
  db.exec(
    "INSERT INTO jobs(id,owner,idempotency,input_hash,input,status,created_at,updated_at,call_started,error) VALUES('persisted-job','owner','once','hash','{}','failed',unixepoch(),unixepoch(),'caption','Provider returned an error')",
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      error: {
        code: 503,
        message: "Upstream temporarily unavailable",
        metadata: { provider_name: "xAI" },
      },
    }),
  );
  await expect(
    openrouter(
      env,
      "chat/completions",
      { model: "x-ai/grok-4.3" },
      1000,
      "persisted-job",
    ),
  ).rejects.toThrow("Provider returned an error");
  const details = await statDetails(env, "failed", 0, 0);
  expect(details?.rows[0]["Job ID"]).toBe("persisted-job");
  expect(details?.rows[0]["Stage"]).toBe("caption");
  const recorded = JSON.parse(details?.rows[0]["Provider details"] as string);
  expect(recorded.model).toBe("x-ai/grok-4.3");
  expect(recorded.detail).toContain("Upstream temporarily unavailable");
  expect(recorded.detail).toContain("xAI");
});
