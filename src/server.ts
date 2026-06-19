#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { kairoFetch, kairoFetchBinary, KairoError, getActiveConfig, getBaseUrl, setAccessToken, resetAgentSession } from "./client.js";
import { runDeviceLogin, saveCachedToken } from "./device-auth.js";
import { registerAuthTool } from "./tools/register-auth.js";
import { fail, ok } from "./tools/results.js";
import { registerExtraKairoTools } from "./tools/register-extra.js";
import { registerSprintKairoTools } from "./tools/register-sprint.js";
import {
  buildShareLinks,
  enrichExternalSignResponse,
} from "./lib/share-links.js";
import {
  externalSignCommonSchema,
  externalSignRequestBody,
} from "./lib/external-sign.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SignStatus = {
  documentId: string;
  documentName?: string;
  signed: boolean;
  signature?: {
    id: string;
    signedAt: string;
    signerName: string;
    isExternal: boolean;
    verifyUrl: string;
  } | null;
  externalRequest?: {
    id: string;
    status: "pending" | "consumed" | "expired";
    expiresAt: string;
    url: string;
  } | null;
};

export function registerKairoTools(server: McpServer) {
  server.registerTool(
    "kairo_login",
    {
      title: "Iniciar sesión",
      description:
        "Obligatorio antes de cualquier otra herramienta si no hay sesión. Sin argumentos: abre el navegador en /device " +
        "(estilo gh auth login). También acepta access_token (ztk_...) manualmente.",
      inputSchema: {
        access_token: z
          .string()
          .optional()
          .describe("Token ztk_... manual (alternativa al device flow)."),
      },
    },
    async ({ access_token }) => {
      try {
        const baseUrl = getBaseUrl();
        const manual =
          access_token?.trim() || process.env.KAIRO_API_TOKEN?.trim();
        if (manual) {
          setAccessToken(manual, baseUrl);
          await saveCachedToken(baseUrl, manual);
          const data = await kairoFetch<{ user: { name?: string; email?: string } }>(
            "/api/me",
          );
          const u = data.user;
          const label = u?.name || u?.email || "usuario";
          return ok({
            message: `Sesión OK como ${label} (${u?.email ?? "—"}). API: ${baseUrl}`,
            user: u,
          });
        }

        const result = await runDeviceLogin(baseUrl);
        if (result.ok) {
          setAccessToken(result.accessToken, baseUrl);
          const u = result.user;
          const label = u?.name || u?.email || "usuario";
          return ok({
            message: `Sesión OK como ${label} (${u?.email ?? "—"}). Token guardado en ${result.cachePath}`,
            user: u,
          });
        }

        if (result.pending) {
          return ok({
            pending: true,
            message: result.message,
            userCode: result.userCode,
            verificationUriComplete: result.verificationUriComplete,
          });
        }

        return fail(new Error(result.message));
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(
    server,
    "kairo_whoami",
    {
      title: "Quién soy",
      description:
        "Devuelve el usuario asociado al token del agente (sesión MCP), no la del navegador.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await kairoFetch<{ user: unknown }>("/api/me");
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "kairo_disconnect",
    {
      title: "Desconectar agente",
      description:
        "Borra el token cacheado del agente (~/.kairo/). La próxima llamada pedirá autorización de nuevo.",
      inputSchema: {},
    },
    async () => {
      try {
        await resetAgentSession();
        return ok({
          disconnected: true,
          message: "Sesión del agente borrada. Reiniciá el MCP o volvé a autorizar.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_list_documents",
    {
      title: "Listar documentos",
      description:
        "Lista los documentos visibles para el usuario del token, respetando reglas de Estudio (owner/socio/abogado).",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Cantidad máxima de docs a devolver (default 50)."),
      },
    },
    async ({ limit }) => {
      try {
        const data = await kairoFetch<{ documents: unknown[] }>(
          "/api/documents",
        );
        const docs = (data.documents ?? []).slice(0, limit ?? 50);
        return ok({ count: docs.length, documents: docs });
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_get_document",
    {
      title: "Detalle de documento",
      description: "Obtiene un documento por id con sus firmas (si el usuario lo puede ver).",
      inputSchema: {
        documentId: z.string().min(1),
      },
    },
    async ({ documentId }) => {
      try {
        const data = await kairoFetch<unknown>(
          `/api/documents/${encodeURIComponent(documentId)}`,
        );
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_download_document",
    {
      title: "Descargar PDF",
      description:
        "Descarga el PDF original de un documento y devuelve metadata + bytes en base64.",
      inputSchema: {
        documentId: z.string().min(1),
      },
    },
    async ({ documentId }) => {
      try {
        const { data, contentType, filename } = await kairoFetchBinary(
          `/api/documents/${encodeURIComponent(documentId)}/download`,
        );
        const base64 = Buffer.from(data).toString("base64");
        return ok({
          documentId,
          filename,
          contentType,
          sizeBytes: data.byteLength,
          base64,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_list_studios",
    {
      title: "Listar estudios",
      description:
        "Lista los estudios donde el usuario es miembro junto con su rol y áreas.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await kairoFetch<unknown>("/api/studios");
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_get_sign_url",
    {
      title: "Obtener URL para firmar",
      description:
        "Devuelve una URL para abrir en el navegador y firmar con mouse/touch. " +
        "Modo 'account': firma completa con tu cuenta (PIN, firma guardada, certificado fuerte) — requiere sesión iniciada en el browser. " +
        "Modo 'external': link efímero sin login (duración según settings del usuario). " +
        "No intentes firmar desde la terminal: la experiencia con canvas no es usable ahí.",
      inputSchema: {
        documentId: z.string().min(1),
        mode: z
          .enum(["account", "external"])
          .default("account")
          .describe(
            "account = /sign/{id} con tu cuenta; external = link público.",
          ),
        recipientName: externalSignCommonSchema.recipientName,
        recipientEmail: externalSignCommonSchema.recipientEmail,
        inviteMessage: externalSignCommonSchema.inviteMessage,
        sendEmail: externalSignCommonSchema.sendEmail,
        placement: externalSignCommonSchema.placement,
      },
    },
    async ({
      documentId,
      mode,
      recipientName,
      recipientEmail,
      inviteMessage,
      sendEmail,
      placement,
    }) => {
      try {
        const doc = await kairoFetch<{
          document?: { id: string; filename: string; alias?: string | null };
        }>(`/api/documents/${encodeURIComponent(documentId)}`);
        const meta = doc.document;
        if (!meta) {
          return fail(new KairoError("Documento no encontrado", 404, doc));
        }

        const cfg = getActiveConfig();
        const label = meta.alias ?? meta.filename;
        const waitSince = new Date().toISOString();

        if (mode === "account") {
          const url = `${cfg.baseUrl}/sign/${encodeURIComponent(documentId)}`;
          return ok({
            mode: "account",
            documentId,
            documentName: label,
            url,
            expiresAt: null,
            waitSince,
            waitParams: {
              documentId,
              since: waitSince,
              accountOnly: true,
            },
            instructions:
              "Abrí esta URL en el navegador estando logueado en Zyta. Vas a dibujar la firma (o usar la guardada), ingresar PIN y completar el flujo criptográfico completo.",
            note: "Después podés usar kairo_wait_for_signature con waitParams para avisarte cuando firmaste.",
          });
        }

        const ext = await kairoFetch<{
          request?: {
            url: string;
            expiresAt: string;
            id: string;
            linkTtl?: string;
          };
        }>(`/api/documents/${encodeURIComponent(documentId)}/external-requests`, {
          method: "POST",
          body: externalSignRequestBody({
            recipientName,
            recipientEmail,
            inviteMessage,
            sendEmail,
            placement,
          }),
        });

        const url = ext.request?.url;
        const share = buildShareLinks({
          url: url ?? "",
          recipientName,
          recipientEmail,
          inviteMessage,
          documentName: label,
        });

        return ok(
          enrichExternalSignResponse(
            {
              mode: "external",
              documentId,
              documentName: label,
              url,
              expiresAt: ext.request?.expiresAt,
              linkTtl: ext.request?.linkTtl,
              requestId: ext.request?.id,
              waitSince,
              waitParams: {
                documentId,
                since: waitSince,
                externalRequestId: ext.request?.id,
              },
              instructions:
                "Abrí la URL en cualquier dispositivo. Compartí por WhatsApp/Telegram con los share links.",
              note: "Usá kairo_wait_for_signature con waitParams.",
            },
            share,
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_wait_for_signature",
    {
      title: "Esperar firma completada",
      description:
        "Hace polling hasta que el documento se firme o se agote el tiempo. " +
        "Usá los waitParams que devuelve kairo_get_sign_url. " +
        "Cuando signed=true, incluye verifyUrl para ver el certificado.",
      inputSchema: {
        documentId: z.string().min(1),
        since: z
          .string()
          .optional()
          .describe("ISO timestamp desde kairo_get_sign_url (waitSince)."),
        externalRequestId: z
          .string()
          .optional()
          .describe("ID del pedido externo (mode=external)."),
        accountOnly: z
          .boolean()
          .optional()
          .describe("true = solo firmas con tu cuenta (mode=account)."),
        timeoutSeconds: z
          .number()
          .int()
          .min(10)
          .max(900)
          .optional()
          .describe("Máximo de espera en segundos (default 600)."),
        pollIntervalSeconds: z
          .number()
          .int()
          .min(2)
          .max(30)
          .optional()
          .describe("Intervalo entre consultas (default 5)."),
      },
    },
    async ({
      documentId,
      since,
      externalRequestId,
      accountOnly,
      timeoutSeconds,
      pollIntervalSeconds,
    }) => {
      try {
        const timeoutMs = (timeoutSeconds ?? 600) * 1000;
        const intervalMs = (pollIntervalSeconds ?? 5) * 1000;
        const started = Date.now();
        let polls = 0;

        while (Date.now() - started < timeoutMs) {
          polls += 1;
          const q = new URLSearchParams();
          if (since) q.set("since", since);
          if (externalRequestId) {
            q.set("externalRequestId", externalRequestId);
          }
          if (accountOnly) q.set("accountOnly", "true");

          const status = await kairoFetch<SignStatus>(
            `/api/documents/${encodeURIComponent(documentId)}/sign-status?${q.toString()}`,
          );

          if (status.signed && status.signature) {
            return ok({
              ...status,
              polls,
              waitedMs: Date.now() - started,
              message: `Firmado por ${status.signature.signerName} a las ${status.signature.signedAt}.`,
            });
          }

          if (status.externalRequest?.status === "expired") {
            return ok({
              signed: false,
              timedOut: true,
              reason: "expired",
              documentId,
              externalRequest: status.externalRequest,
              polls,
              waitedMs: Date.now() - started,
              message:
                "El link de firma externa expiró sin completarse. Generá uno nuevo con kairo_get_sign_url.",
            });
          }

          await sleep(intervalMs);
        }

        const qs = new URLSearchParams();
        if (since) qs.set("since", since);
        if (externalRequestId) qs.set("externalRequestId", externalRequestId);
        if (accountOnly) qs.set("accountOnly", "true");

        const last = await kairoFetch<SignStatus>(
          `/api/documents/${encodeURIComponent(documentId)}/sign-status?${qs.toString()}`,
        );

        return ok({
          ...last,
          signed: false,
          timedOut: true,
          reason: "timeout",
          polls,
          waitedMs: Date.now() - started,
          message:
            "Tiempo de espera agotado. Si aún no firmaste, abrí la URL y completá el flujo en el navegador.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_request_external_sign",
    {
      title: "Pedir firma externa (legacy)",
      description:
        "Preferí kairo_get_sign_url(mode=external) o kairo_sign_workflow. Crea link externo con share links.",
      inputSchema: {
        documentId: z.string().min(1),
        ...externalSignCommonSchema,
      },
    },
    async ({
      documentId,
      recipientName,
      recipientEmail,
      inviteMessage,
      sendEmail,
      placement,
    }) => {
      try {
        const doc = await kairoFetch<{
          document?: { filename: string; alias?: string | null };
        }>(`/api/documents/${encodeURIComponent(documentId)}`);
        const label = doc.document?.alias ?? doc.document?.filename ?? "documento";

        const data = await kairoFetch<{
          request?: { id: string; url: string; expiresAt: string; linkTtl: string };
        }>(`/api/documents/${encodeURIComponent(documentId)}/external-requests`, {
          method: "POST",
          body: externalSignRequestBody({
            recipientName,
            recipientEmail,
            inviteMessage,
            sendEmail,
            placement,
          }),
        });

        const url = data.request?.url ?? "";
        const share = buildShareLinks({
          url,
          recipientName,
          recipientEmail,
          inviteMessage,
          documentName: label,
        });

        return ok(
          enrichExternalSignResponse(
            {
              deprecated: true,
              useInstead: "kairo_get_sign_url(mode=external) o kairo_sign_workflow",
              request: data.request,
              waitParams: {
                documentId,
                since: new Date().toISOString(),
                externalRequestId: data.request?.id,
              },
            },
            share,
          ),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_list_external_requests",
    {
      title: "Listar firmas externas pendientes",
      description:
        "Lista los pedidos de firma externa (token efímero) abiertos para un documento.",
      inputSchema: {
        documentId: z.string().min(1),
      },
    },
    async ({ documentId }) => {
      try {
        const data = await kairoFetch<unknown>(
          `/api/documents/${encodeURIComponent(documentId)}/external-requests`,
        );
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_revoke_external_request",
    {
      title: "Revocar pedido de firma externa",
      description:
        "Invalida un pedido de firma externa (el link deja de funcionar inmediatamente). Requiere scope 'write'.",
      inputSchema: {
        documentId: z.string().min(1),
        requestId: z.string().min(1),
      },
    },
    async ({ documentId, requestId }) => {
      try {
        const data = await kairoFetch<unknown>(
          `/api/documents/${encodeURIComponent(documentId)}/external-requests/${encodeURIComponent(requestId)}`,
          { method: "DELETE" },
        );
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_create_studio",
    {
      title: "Crear estudio",
      description:
        "Crea un nuevo estudio (requiere plan Premium y scope 'write'). Devuelve el estudio creado.",
      inputSchema: {
        name: z.string().min(2).max(80),
      },
    },
    async ({ name }) => {
      try {
        const data = await kairoFetch<unknown>("/api/studios", {
          method: "POST",
          body: { name },
        });
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerAuthTool(server,
    "kairo_verify_signature",
    {
      title: "Verificar firma por hash",
      description:
        "Verifica una firma de Zyta a partir del hash del documento. No requiere subir el PDF.",
      inputSchema: {
        documentHash: z.string().regex(/^[a-f0-9]{64}$/i),
      },
    },
    async ({ documentHash }) => {
      try {
        const data = await kairoFetch<unknown>(
          `/api/verify?hash=${encodeURIComponent(documentHash)}`,
        );
        return ok(data);
      } catch (e) {
        return fail(e);
      }
    },
  );

  registerExtraKairoTools(server);
  registerSprintKairoTools(server);
}

async function main() {
  if (process.env.KAIRO_AGENT_BRIDGE !== "0") {
    const { startAgentBridge } = await import("./bridge.js");
    startAgentBridge().catch(() => {
      process.stderr.write("[kairo-mcp] agent bridge no pudo iniciar\n");
    });
  }

  const server = new McpServer({
    name: "zyta-sign-mcp",
    version: "0.4.0",
  });
  registerKairoTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `[kairo-mcp] listo (stdio). Base: ${getBaseUrl()} — usá kairo_login si no hay sesión.`,
  );
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const resolvedEntry = path.resolve(entry);
  const self = fileURLToPath(import.meta.url);
  return (
    resolvedEntry === self ||
    resolvedEntry === self.replace(/\.ts$/, ".js")
  );
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error("[kairo-mcp] fatal:", err);
    process.exit(1);
  });
}
