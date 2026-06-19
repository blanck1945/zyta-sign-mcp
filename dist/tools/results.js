import { AuthRequiredError, KairoError } from "../client.js";
export function ok(data) {
    const text = JSON.stringify(data, null, 2);
    const isObject = data !== null && typeof data === "object" && !Array.isArray(data);
    return {
        content: [{ type: "text", text }],
        ...(isObject ? { structuredContent: data } : {}),
    };
}
export function fail(err) {
    const msg = err instanceof AuthRequiredError
        ? err.message
        : err instanceof KairoError
            ? `Kairo error (${err.status}): ${err.message}`
            : err instanceof Error
                ? err.message
                : String(err);
    return {
        content: [{ type: "text", text: msg }],
        isError: true,
    };
}
