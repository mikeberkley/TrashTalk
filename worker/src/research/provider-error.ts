// Provider responses can echo request data. Sanitize before emitting diagnostics.
export function providerErrorDetail(
  value: unknown,
  body: unknown,
  secret: string,
) {
  const privateValues: string[] = secret ? [secret] : [];
  function collect(v: unknown, key = "") {
    if (typeof v === "string" && v.length >= 4 && key !== "model")
      privateValues.push(v);
    else if (Array.isArray(v)) v.forEach((x) => collect(x, key));
    else if (v && typeof v === "object")
      Object.entries(v).forEach(([k, x]) => collect(x, k));
  }
  collect(body);
  let text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  for (const item of privateValues.sort((a, b) => b.length - a.length)) {
    text = text.split(item).join("[redacted]");
    const escaped = JSON.stringify(item).slice(1, -1);
    text = text.split(escaped).join("[redacted]");
  }
  return text
    .replace(/data:[^\s"']+/gi, "[redacted image]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted key]")
    .slice(0, 4096);
}
