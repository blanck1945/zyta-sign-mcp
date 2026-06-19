import http from "node:http";
import { getBaseUrl, resetAgentSession, setAccessToken } from "./client.js";
import { saveCachedToken, sessionFilePath } from "./device-auth.js";
const HOST = "127.0.0.1";
const DEFAULT_PORT = 9322;
function bridgePort() {
    return Number(process.env.KAIRO_AGENT_BRIDGE_PORT ?? DEFAULT_PORT);
}
function bridgeSecret() {
    const s = process.env.KAIRO_AGENT_BRIDGE_SECRET?.trim();
    return s || null;
}
function allowedOrigins() {
    return new Set([
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        process.env.KAIRO_BASE_URL,
        process.env.NEXT_PUBLIC_APP_URL,
    ]
        .filter(Boolean)
        .map((o) => String(o).replace(/\/+$/, "")));
}
function isOriginAllowed(req) {
    const origin = req.headers.origin;
    if (!origin)
        return true;
    return allowedOrigins().has(origin.replace(/\/+$/, ""));
}
function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 64_000)
                reject(new Error("Payload too large"));
        });
        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}
function send(res, status, data, corsOrigin) {
    const headers = { "Content-Type": "application/json" };
    if (corsOrigin)
        headers["Access-Control-Allow-Origin"] = corsOrigin;
    res.writeHead(status, headers);
    res.end(JSON.stringify(data));
}
function checkSecret(req) {
    const secret = bridgeSecret();
    if (!secret)
        return false;
    return req.headers["x-bridge-secret"] === secret;
}
async function writeBridgeSession(accessToken) {
    const baseUrl = getBaseUrl();
    await saveCachedToken(baseUrl, accessToken);
    setAccessToken(accessToken, baseUrl);
}
async function clearBridgeSession() {
    await resetAgentSession();
}
export function startAgentBridge() {
    const secret = bridgeSecret();
    const port = bridgePort();
    const server = http.createServer(async (req, res) => {
        const corsOrigin = req.headers.origin || "http://localhost:3000";
        if (!isOriginAllowed(req)) {
            send(res, 403, { error: "Origin not allowed" }, corsOrigin);
            return;
        }
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": corsOrigin,
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Secret",
            });
            res.end();
            return;
        }
        if (req.url === "/health" && req.method === "GET") {
            send(res, 200, {
                ok: true,
                hasSecret: Boolean(secret),
                cachePath: sessionFilePath(getBaseUrl()),
            }, corsOrigin);
            return;
        }
        if (!secret) {
            send(res, 503, {
                error: "Bridge sin configurar. Seteá KAIRO_AGENT_BRIDGE_SECRET en mcp.json.",
            }, corsOrigin);
            return;
        }
        if (!checkSecret(req)) {
            send(res, 401, { error: "Invalid bridge secret" }, corsOrigin);
            return;
        }
        try {
            if (req.url === "/session" && req.method === "POST") {
                const body = await readJson(req);
                const accessToken = body.accessToken;
                if (typeof accessToken !== "string" || !accessToken.trim()) {
                    send(res, 400, { error: "accessToken required" }, corsOrigin);
                    return;
                }
                await writeBridgeSession(accessToken.trim());
                send(res, 200, { ok: true }, corsOrigin);
                return;
            }
            if (req.url === "/session" && req.method === "DELETE") {
                await clearBridgeSession();
                send(res, 200, { ok: true }, corsOrigin);
                return;
            }
            if (req.url === "/session" && req.method === "GET") {
                send(res, 200, { active: Boolean(secret) }, corsOrigin);
                return;
            }
            send(res, 404, { error: "Not found" }, corsOrigin);
        }
        catch (err) {
            send(res, 500, { error: err instanceof Error ? err.message : "Bridge error" }, corsOrigin);
        }
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
            process.stderr.write(`[kairo-mcp] agent bridge en http://${HOST}:${port} (localhost + secreto compartido)\n`);
            resolve(server);
        });
    });
}
