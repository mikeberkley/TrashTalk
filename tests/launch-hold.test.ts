import { it, expect, vi } from "vitest";
vi.mock("../worker/src/Coordinator", () => ({ Coordinator: class {} }));
import worker from "../worker/src/index";
it("production launch hold blocks assets, purchase, generation and auth before accessing bindings", async () => {
  for (const path of [
    "/assets/index.js",
    "/api/billing/checkout",
    "/api/generations",
    "/api/auth/google",
  ]) {
    const response = await worker.fetch(
      new Request("https://trashtalk.fanlift.ai" + path),
      { ENVIRONMENT: "production", LAUNCH_HOLD: "true" } as any,
      {} as any,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
});
it("production launch hold leaves webhook signature handling reachable", async () => {
  const response = await worker.fetch(
    new Request("https://trashtalk.fanlift.ai/api/billing/webhook", {
      method: "POST",
      body: "{}",
    }),
    {
      ENVIRONMENT: "production",
      LAUNCH_HOLD: "true",
      STRIPE_SECRET_KEY: "sk_live_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    } as any,
    {} as any,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("signature");
});
it("legal pages and descriptive homepage remain public during the production hold", async () => {
  for (const [path, title] of [
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms of Service"],
    ["/", "Sports rivalry. Made personal."],
  ]) {
    const response = await worker.fetch(
      new Request("https://trashtalk.fanlift.ai" + path),
      { ENVIRONMENT: "production", LAUNCH_HOLD: "true" } as any,
      {} as any,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(title);
    expect(html).toContain("Mike Berkley");
    expect(html).toContain("mike@earthly.art");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(response.headers.get("set-cookie")).toBeNull();
  }
});
