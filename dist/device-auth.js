import { readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { openBrowser } from "./browser.js";
import { writeDeviceAuthComplete } from "./cursor-notify.js";
const DEVICE_POLL_BUDGET_MS = 45_000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function kairoDir() {
    return process.env.KAIRO_TOKEN_CACHE_DIR ?? join(homedir(), ".kairo");
}
export function sessionFilePath(baseUrl) {
    const slug = Buffer.from(baseUrl).toString("base64url").slice(0, 16);
    return join(kairoDir(), `credentials-${slug}.json`);
}
function pendingDevicePath() {
    return join(kairoDir(), "device-pending.json");
}
async function loadCache(baseUrl) {
    try {
        const raw = await readFile(sessionFilePath(baseUrl), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.baseUrl !== baseUrl || !parsed.accessToken)
            return null;
        return parsed.accessToken;
    }
    catch {
        return null;
    }
}
export async function saveCachedToken(baseUrl, accessToken) {
    const path = sessionFilePath(baseUrl);
    await mkdir(dirname(path), { recursive: true });
    const payload = {
        baseUrl,
        accessToken,
        obtainedAt: new Date().toISOString(),
    };
    await writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
}
export async function clearCachedToken(baseUrl) {
    try {
        await unlink(sessionFilePath(baseUrl));
    }
    catch {
        /* no cache */
    }
}
export async function validateToken(baseUrl, token) {
    try {
        const res = await fetch(`${baseUrl}/api/me`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
export async function loadValidCachedToken(baseUrl) {
    const cached = await loadCache(baseUrl);
    if (!cached)
        return null;
    if (!(await validateToken(baseUrl, cached)))
        return null;
    return cached;
}
export function readPendingDevice() {
    try {
        const raw = readFileSync(pendingDevicePath(), "utf8");
        const data = JSON.parse(raw);
        if (data.expiresAt <= Date.now())
            return null;
        return data;
    }
    catch {
        return null;
    }
}
async function writePendingDevice(pending) {
    await mkdir(kairoDir(), { recursive: true });
    await writeFile(pendingDevicePath(), JSON.stringify(pending, null, 2), "utf8");
}
export async function clearPendingDevice() {
    try {
        await unlink(pendingDevicePath());
    }
    catch {
        /* ignore */
    }
}
async function requestDeviceCode(baseUrl) {
    const startRes = await fetch(`${baseUrl}/api/oauth/device`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            client_id: "kairo-mcp",
            client_label: process.env.KAIRO_CLIENT_LABEL ?? "Agente MCP",
            scope: "read write",
        }),
    });
    const start = (await startRes.json());
    if (!startRes.ok || !start.device_code) {
        throw new Error(start.error ??
            "No se pudo iniciar Device Authorization Flow. ¿Está corriendo Kairo?");
    }
    return start;
}
async function pollDeviceTokenOnce(baseUrl, deviceCode) {
    const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
    });
    const res = await fetch(`${baseUrl}/api/oauth/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body,
    });
    const data = (await res.json());
    if (res.ok && data.access_token) {
        return { ok: true, accessToken: data.access_token };
    }
    const err = data.error ?? "unknown";
    if (err === "authorization_pending" ||
        err === "slow_down" ||
        err === "expired_token" ||
        err === "access_denied") {
        return { ok: false, error: err };
    }
    throw new Error(data.error_description ?? data.error ?? `Error OAuth (${res.status})`);
}
async function fetchUserProfile(baseUrl, token) {
    try {
        const res = await fetch(`${baseUrl}/api/me`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        return data.user ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Login estilo `gh auth login`: pide código, abre browser en /device y hace polling.
 */
export async function runDeviceLogin(baseUrl) {
    let pending = readPendingDevice();
    if (!pending || pending.baseUrl !== baseUrl || pending.expiresAt <= Date.now()) {
        const code = await requestDeviceCode(baseUrl);
        pending = {
            baseUrl,
            deviceCode: code.device_code,
            userCode: code.user_code,
            verificationUri: code.verification_uri,
            verificationUriComplete: code.verification_uri_complete,
            expiresAt: Date.now() + code.expires_in * 1000,
            interval: code.interval || 5,
        };
        await writePendingDevice(pending);
        openBrowser(pending.verificationUriComplete);
    }
    let interval = pending.interval || 5;
    const deadline = Date.now() + DEVICE_POLL_BUDGET_MS;
    while (Date.now() < deadline) {
        await sleep(interval * 1000);
        const result = await pollDeviceTokenOnce(baseUrl, pending.deviceCode);
        if (result.ok) {
            await saveCachedToken(baseUrl, result.accessToken);
            await clearPendingDevice();
            const user = await fetchUserProfile(baseUrl, result.accessToken);
            writeDeviceAuthComplete({
                authorizedAt: new Date().toISOString(),
                userName: user?.name ?? null,
                userEmail: user?.email ?? null,
                clientLabel: process.env.KAIRO_CLIENT_LABEL ?? "Agente MCP",
                scopes: ["read", "write"],
                source: "mcp",
            });
            return {
                ok: true,
                accessToken: result.accessToken,
                user,
                cachePath: sessionFilePath(baseUrl),
            };
        }
        if (result.error === "slow_down") {
            interval += 5;
            continue;
        }
        if (result.error === "authorization_pending")
            continue;
        await clearPendingDevice();
        const reason = result.error === "access_denied"
            ? "Acceso denegado."
            : "El código expiró.";
        return { ok: false, pending: false, message: `${reason} Volvé a llamar a kairo_login.` };
    }
    const minutesLeft = Math.max(1, Math.round((pending.expiresAt - Date.now()) / 60000));
    return {
        ok: false,
        pending: true,
        message: `Abrí ${pending.verificationUriComplete} (o ingresá ${pending.userCode} en ${pending.verificationUri}) ` +
            `y autorizá el acceso. Expira en ~${minutesLeft} min. Volvé a llamar a kairo_login cuando confirmes.`,
        verificationUriComplete: pending.verificationUriComplete,
        userCode: pending.userCode,
    };
}
