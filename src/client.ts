import { AsyncLocalStorage } from "node:async_hooks";

export type KairoConfig = {
  baseUrl: string;
  token: string;
};

export class KairoError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

export class AuthRequiredError extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        "Sin sesión activa. Usá la herramienta `kairo_login` para autorizar el agente.",
    );
    this.name = "AuthRequiredError";
  }
}

const requestAuth = new AsyncLocalStorage<KairoConfig>();

export function runWithRequestAuth<T>(
  cfg: KairoConfig,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return requestAuth.run(cfg, fn);
}

let cached: KairoConfig | null = null;

export function getBaseUrl(): string {
  return (process.env.KAIRO_BASE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

export function setAccessToken(token: string, baseUrl = getBaseUrl()): void {
  cached = { baseUrl, token: token.trim() };
}

export async function ensureToken(): Promise<string> {
  const ctx = requestAuth.getStore();
  if (ctx?.token) return ctx.token;

  if (cached?.token) {
    const { validateToken } = await import("./device-auth.js");
    if (await validateToken(cached.baseUrl, cached.token)) {
      return cached.token;
    }
    cached = null;
  }

  const baseUrl = getBaseUrl();
  const { loadValidCachedToken } = await import("./device-auth.js");
  const fromDisk = await loadValidCachedToken(baseUrl);
  if (fromDisk) {
    cached = { baseUrl, token: fromDisk };
    return fromDisk;
  }

  throw new AuthRequiredError();
}

export async function requireAuth(): Promise<void> {
  await ensureToken();
}

export function getConfig(): KairoConfig {
  const ctx = requestAuth.getStore();
  if (ctx) return ctx;
  if (!cached?.token) {
    throw new AuthRequiredError();
  }
  return cached;
}

export function getActiveConfig(): KairoConfig {
  return getConfig();
}

async function resolveConfig(): Promise<KairoConfig> {
  const ctx = requestAuth.getStore();
  if (ctx) return ctx;
  const token = await ensureToken();
  return { baseUrl: getBaseUrl(), token };
}

export async function resetAgentSession(): Promise<void> {
  const baseUrl = getBaseUrl();
  const { clearCachedToken, clearPendingDevice } = await import("./device-auth.js");
  await clearCachedToken(baseUrl);
  await clearPendingDevice();
  cached = null;
}

type JsonInit = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
};

export async function kairoFetch<T>(
  path: string,
  init: JsonInit = {},
): Promise<T> {
  const cfg = await resolveConfig();
  const url = `${cfg.baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/json",
    ...init.headers,
  };
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    if (init.body instanceof FormData) {
      body = init.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
  }
  const res = await fetch(url, { ...init, headers, body });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (res.status === 401) {
    cached = null;
    throw new AuthRequiredError("La sesión expiró. Volvé a llamar a kairo_login.");
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error?: unknown }).error)
        : `HTTP ${res.status}`;
    throw new KairoError(msg, res.status, parsed);
  }
  return parsed as T;
}

export async function kairoFetchBinary(
  path: string,
): Promise<{ data: Uint8Array; contentType: string; filename: string | null }> {
  const cfg = await resolveConfig();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (res.status === 401) {
    cached = null;
    throw new AuthRequiredError("La sesión expiró. Volvé a llamar a kairo_login.");
  }
  if (!res.ok) {
    throw new KairoError(`HTTP ${res.status}`, res.status, await res.text());
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const cd = res.headers.get("content-disposition");
  const m = cd ? /filename="?([^";]+)"?/i.exec(cd) : null;
  return {
    data: buf,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    filename: m ? m[1]! : null,
  };
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function kairoUploadDocument(opts: {
  base64: string;
  filename: string;
  alias?: string;
  studioId?: string;
  areaId?: string;
  force?: boolean;
}): Promise<unknown> {
  const buf = Buffer.from(opts.base64, "base64");
  if (buf.length < 100) {
    throw new KairoError("El PDF en base64 está vacío o es inválido.", 400, null);
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new KairoError(
      `El PDF supera el límite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      400,
      null,
    );
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([buf], { type: "application/pdf" }),
    opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`,
  );
  if (opts.alias?.trim()) form.append("alias", opts.alias.trim());
  if (opts.studioId) form.append("studioId", opts.studioId);
  if (opts.areaId) form.append("areaId", opts.areaId);
  if (opts.force) form.append("force", "true");

  return kairoFetch("/api/documents", { method: "POST", body: form });
}

