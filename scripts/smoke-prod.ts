const baseUrl = (process.env.KAIRO_BASE_URL ?? "https://sign.zyta.app").replace(
  /\/$/,
  "",
);

async function main() {
  console.log("[smoke-prod] base:", baseUrl);

  const deviceRes = await fetch(`${baseUrl}/api/oauth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "kairo-mcp",
      client_label: "Smoke Prod",
      scope: "read write",
    }),
  });
  const device = await deviceRes.json();
  console.log("[smoke-prod] POST /api/oauth/device ->", deviceRes.status, device);
  if (!deviceRes.ok || !device.user_code) {
    throw new Error("Device flow no disponible");
  }

  const quotaRes = await fetch(`${baseUrl}/api/auth/quota`);
  console.log("[smoke-prod] GET /api/auth/quota (sin token) ->", quotaRes.status);
  if (quotaRes.status !== 401) {
    throw new Error(`Se esperaba 401 en quota sin token, recibido ${quotaRes.status}`);
  }

  const webhooksRes = await fetch(`${baseUrl}/api/webhooks`);
  console.log("[smoke-prod] GET /api/webhooks (sin token) ->", webhooksRes.status);
  if (webhooksRes.status !== 401) {
    throw new Error(`Se esperaba 401 en webhooks sin token, recibido ${webhooksRes.status}`);
  }

  const token = process.env.KAIRO_API_TOKEN?.trim();
  if (token) {
    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await meRes.json();
    console.log("[smoke-prod] GET /api/me ->", meRes.status, me.user?.email ?? me);

    const quotaAuth = await fetch(`${baseUrl}/api/auth/quota`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const quotaBody = await quotaAuth.text();
    console.log(
      "[smoke-prod] GET /api/auth/quota (con token) ->",
      quotaAuth.status,
      quotaBody.slice(0, 200),
    );
    if (!quotaAuth.ok) {
      throw new Error("quota con token falló");
    }
  } else {
    console.log("[smoke-prod] Sin KAIRO_API_TOKEN — omitiendo pruebas autenticadas.");
    console.log("[smoke-prod] Creá un token en el dashboard o usá kairo_login en Cursor.");
  }

  console.log("[smoke-prod] OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
