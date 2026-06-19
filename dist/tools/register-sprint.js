import { z } from "zod";
import { kairoFetch, kairoFetchBinary, kairoUploadDocument, } from "../client.js";
import { openBrowser } from "../browser.js";
import { fail, ok } from "./results.js";
import { registerAuthTool } from "./register-auth.js";
import { buildShareLinks, enrichExternalSignResponse, } from "../lib/share-links.js";
import { externalSignCommonSchema, externalSignRequestBody, } from "../lib/external-sign.js";
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function registerSprintKairoTools(server) {
    registerAuthTool(server, "kairo_get_plan_quota", {
        title: "Plan y cuota de firmas",
        description: "Devuelve plan (free/premium), features, firmas usadas este mes y límite.",
        inputSchema: {},
    }, async () => {
        try {
            return ok(await kairoFetch("/api/auth/quota"));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_verify_document", {
        title: "Verificar PDF subido",
        description: "Sube un PDF y verifica contra signatureId o certificado JSON.",
        inputSchema: {
            pdfBase64: z.string().min(1),
            signatureId: z.string().optional(),
            certificateJson: z.string().optional(),
        },
    }, async ({ pdfBase64, signatureId, certificateJson }) => {
        try {
            const buf = Buffer.from(pdfBase64, "base64");
            const form = new FormData();
            form.append("file", new Blob([buf], { type: "application/pdf" }), "verify.pdf");
            if (signatureId)
                form.append("signatureId", signatureId);
            if (certificateJson)
                form.append("certificate", certificateJson);
            return ok(await kairoFetch("/api/verify", { method: "POST", body: form }));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_create_external_bundle", {
        title: "Crear paquete de firma externa",
        description: "Varios PDFs en un solo link. Mínimo 2 documentos.",
        inputSchema: {
            documentIds: z.array(z.string().min(1)).min(2).max(25),
            ...externalSignCommonSchema,
        },
    }, async ({ documentIds, recipientName, recipientEmail, inviteMessage, sendEmail, }) => {
        try {
            const data = await kairoFetch("/api/external-sign/bundles", {
                method: "POST",
                body: {
                    documentIds,
                    ...externalSignRequestBody({
                        recipientName,
                        recipientEmail,
                        inviteMessage,
                        sendEmail,
                    }),
                },
            });
            const bundle = data.bundle;
            const share = buildShareLinks({
                url: bundle.url,
                recipientName,
                recipientEmail,
                inviteMessage,
                documentName: `${bundle.documentCount} documentos`,
            });
            return ok(enrichExternalSignResponse({
                bundle,
                waitParams: { bundleId: bundle.id, since: new Date().toISOString() },
            }, share));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_get_external_bundle_status", {
        title: "Estado del paquete externo",
        inputSchema: { bundleId: z.string().min(1) },
    }, async ({ bundleId }) => {
        try {
            return ok(await kairoFetch(`/api/external-sign/bundles/${encodeURIComponent(bundleId)}/status`));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_wait_for_external_bundle", {
        title: "Esperar paquete firmado",
        inputSchema: {
            bundleId: z.string().min(1),
            timeoutSeconds: z.number().int().min(10).max(900).optional(),
            pollIntervalSeconds: z.number().int().min(2).max(30).optional(),
        },
    }, async ({ bundleId, timeoutSeconds, pollIntervalSeconds }) => {
        try {
            const timeoutMs = (timeoutSeconds ?? 600) * 1000;
            const intervalMs = (pollIntervalSeconds ?? 5) * 1000;
            const started = Date.now();
            let polls = 0;
            while (Date.now() - started < timeoutMs) {
                polls += 1;
                const status = await kairoFetch(`/api/external-sign/bundles/${encodeURIComponent(bundleId)}/status`);
                if (status.bundle.allSigned || status.bundle.status === "complete") {
                    return ok({ ...status, complete: true, polls });
                }
                if (status.bundle.expired) {
                    return ok({ ...status, complete: false, reason: "expired", polls });
                }
                await sleep(intervalMs);
            }
            const last = await kairoFetch(`/api/external-sign/bundles/${encodeURIComponent(bundleId)}/status`);
            return ok({ ...last, complete: false, reason: "timeout", polls });
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_upload_documents", {
        title: "Subir varios PDFs",
        inputSchema: {
            files: z
                .array(z.object({
                base64: z.string().min(1),
                filename: z.string().min(1),
                alias: z.string().max(80).optional(),
            }))
                .min(1)
                .max(10),
            studioId: z.string().optional(),
            areaId: z.string().optional(),
            force: z.boolean().optional(),
        },
    }, async ({ files, studioId, areaId, force }) => {
        try {
            const results = [];
            for (const file of files) {
                try {
                    const doc = await kairoUploadDocument({
                        base64: file.base64,
                        filename: file.filename,
                        alias: file.alias,
                        studioId,
                        areaId,
                        force,
                    });
                    results.push({ filename: file.filename, ok: true, document: doc });
                }
                catch (err) {
                    results.push({
                        filename: file.filename,
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            return ok({
                total: files.length,
                succeeded: results.filter((r) => r.ok).length,
                results,
            });
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_signature_diff", {
        title: "Informe diff PDF (Premium)",
        inputSchema: {
            signatureId: z.string().min(1),
            pdfBase64: z.string().min(1),
        },
    }, async ({ signatureId, pdfBase64 }) => {
        try {
            const buf = Buffer.from(pdfBase64, "base64");
            const form = new FormData();
            form.append("file", new Blob([buf], { type: "application/pdf" }), "compare.pdf");
            return ok(await kairoFetch(`/api/signatures/${encodeURIComponent(signatureId)}/diff`, { method: "POST", body: form }));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_signature_anchor", {
        title: "Anclaje OpenTimestamps",
        inputSchema: {
            signatureId: z.string().min(1),
            action: z.enum(["status", "upgrade", "download_proof"]).default("status"),
        },
    }, async ({ signatureId, action }) => {
        try {
            if (action === "download_proof") {
                const { data, filename } = await kairoFetchBinary(`/api/signatures/${encodeURIComponent(signatureId)}/ots`);
                return ok({
                    signatureId,
                    filename,
                    base64: Buffer.from(data).toString("base64"),
                });
            }
            if (action === "upgrade") {
                return ok(await kairoFetch(`/api/signatures/${encodeURIComponent(signatureId)}/anchor`, { method: "POST" }));
            }
            return ok(await kairoFetch(`/api/signatures/${encodeURIComponent(signatureId)}/anchor`));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_open_browser", {
        title: "Abrir URL en navegador",
        inputSchema: { url: z.string().url() },
    }, async ({ url }) => {
        try {
            openBrowser(url);
            return ok({ opened: true, url });
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_list_webhooks", { title: "Listar webhooks", inputSchema: {} }, async () => {
        try {
            return ok(await kairoFetch("/api/webhooks"));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_create_webhook", {
        title: "Crear webhook",
        inputSchema: {
            url: z.string().url(),
            events: z
                .array(z.enum([
                "signature.completed",
                "external.sign.completed",
                "external.bundle.completed",
            ]))
                .optional(),
            secret: z.string().max(128).optional(),
        },
    }, async ({ url, events, secret }) => {
        try {
            return ok(await kairoFetch("/api/webhooks", {
                method: "POST",
                body: { url, events, secret },
            }));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_delete_webhook", {
        title: "Eliminar webhook",
        inputSchema: { webhookId: z.string().min(1) },
    }, async ({ webhookId }) => {
        try {
            return ok(await kairoFetch(`/api/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" }));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_get_external_sign_settings", { title: "Settings firma externa", inputSchema: {} }, async () => {
        try {
            return ok(await kairoFetch("/api/auth/external-sign-settings"));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_update_external_sign_settings", {
        title: "Actualizar settings firma externa",
        inputSchema: {
            externalSignLinkTtl: z
                .enum(["10m", "30m", "1h", "12h", "24h", "on_sign"])
                .optional(),
            externalSignExpireOnSign: z.boolean().optional(),
        },
    }, async ({ externalSignLinkTtl, externalSignExpireOnSign }) => {
        try {
            const body = {};
            if (externalSignLinkTtl)
                body.externalSignLinkTtl = externalSignLinkTtl;
            if (externalSignExpireOnSign !== undefined) {
                body.externalSignExpireOnSign = externalSignExpireOnSign;
            }
            return ok(await kairoFetch("/api/auth/external-sign-settings", {
                method: "PATCH",
                body,
            }));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_sign_workflow", {
        title: "Workflow: subir y pedir firma",
        description: "Sube PDF, crea link externo, devuelve share links.",
        inputSchema: {
            pdfBase64: z.string().min(1),
            filename: z.string().min(1),
            alias: z.string().max(80).optional(),
            ...externalSignCommonSchema,
            openBrowser: z.boolean().optional(),
        },
    }, async (args) => {
        try {
            const uploaded = (await kairoUploadDocument({
                base64: args.pdfBase64,
                filename: args.filename,
                alias: args.alias,
            }));
            const documentId = uploaded.document?.id;
            if (!documentId)
                return fail(new Error("Sin documentId tras upload"));
            const ext = await kairoFetch(`/api/documents/${encodeURIComponent(documentId)}/external-requests`, {
                method: "POST",
                body: externalSignRequestBody(args),
            });
            const url = ext.request?.url;
            if (!url)
                return fail(new Error("Sin URL externa"));
            const docName = uploaded.document?.alias ?? uploaded.document?.filename ?? args.filename;
            const share = buildShareLinks({
                url,
                recipientName: args.recipientName,
                recipientEmail: args.recipientEmail,
                inviteMessage: args.inviteMessage,
                documentName: docName,
            });
            if (args.openBrowser)
                openBrowser(url);
            return ok(enrichExternalSignResponse({
                documentId,
                documentName: docName,
                url,
                requestId: ext.request?.id,
                expiresAt: ext.request?.expiresAt,
                linkTtl: ext.request?.linkTtl,
                waitParams: {
                    documentId,
                    since: new Date().toISOString(),
                    externalRequestId: ext.request?.id,
                },
            }, share));
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_create_template", {
        title: "[Próximamente] Plantilla",
        inputSchema: { name: z.string().min(1) },
    }, async () => fail(new Error("Plantillas no implementadas. Usá upload + get_sign_url con placement.")));
    registerAuthTool(server, "kairo_create_sequential_sign", {
        title: "[Próximamente] Firma secuencial",
        inputSchema: { documentId: z.string().min(1) },
    }, async () => fail(new Error("Firma secuencial A→B no implementada aún.")));
}
