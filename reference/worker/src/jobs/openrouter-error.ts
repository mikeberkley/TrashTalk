// Keep structured provider diagnostics out of user-facing API responses.
export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    readonly model: string,
    readonly retryAfterSeconds: number | undefined,
    readonly details: Record<string, string | number>,
  ) {
    super(`OpenRouter HTTP ${status}`);
    this.name = 'OpenRouterError';
  }
}
export function retryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds)
    : undefined;
}
export function providerDetails(error: any, secret: string) {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries({
    code: error?.code,
    message: error?.message,
    provider: error?.metadata?.provider_name,
    providerCode: error?.metadata?.provider_error_code,
    limitSource: error?.metadata?.limit_source,
    remedy: error?.metadata?.remedy_hint,
  })) {
    if (typeof value === 'string')
      result[key] = value
        .replaceAll(secret, '[redacted]')
        .replace(/sk-[\w-]+/g, '[redacted]')
        .slice(0, 500);
    else if (typeof value === 'number') result[key] = value;
  }
  return result;
}
