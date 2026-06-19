import { AuthRequiredError, KairoError } from "../client.js";

export function ok(data: unknown) {
  const text = JSON.stringify(data, null, 2);
  const isObject = data !== null && typeof data === "object" && !Array.isArray(data);
  return {
    content: [{ type: "text" as const, text }],
    ...(isObject ? { structuredContent: data as Record<string, unknown> } : {}),
  };
}

export function fail(err: unknown) {
  const msg =
    err instanceof AuthRequiredError
      ? err.message
      : err instanceof KairoError
        ? `Kairo error (${err.status}): ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  };
}
