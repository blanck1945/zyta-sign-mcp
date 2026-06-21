import { z } from "zod";
import { kairoFetch, kairoFetchBinary, kairoUploadDocument, } from "../client.js";
import { fail, ok } from "./results.js";
import { registerAuthTool } from "./register-auth.js";
export function registerExtraKairoTools(server) {
    registerAuthTool(server, "kairo_upload_document", {
        title: "Subir documento PDF",
        description: "Sube un PDF a Zyta. Requiere scope 'write'. Devuelve el documento creado o error 409 si es duplicado (usá force=true para subir igual).",
        inputSchema: {
            base64: z.string().min(1).describe("Contenido del PDF en base64."),
            filename: z.string().min(1).describe("Nombre del archivo (ej. contrato.pdf)."),
            alias: z.string().max(80).optional().describe("Alias opcional para identificarlo."),
            studioId: z.string().optional().describe("ID de estudio destino (opcional)."),
            areaId: z.string().optional().describe("ID de área dentro del estudio (opcional)."),
            force: z
                .boolean()
                .optional()
                .describe("true = subir aunque ya exista el mismo hash."),
        },
    }, async ({ base64, filename, alias, studioId, areaId, force }) => {
        try {
            const data = await kairoUploadDocument({
                base64,
                filename,
                alias,
                studioId,
                areaId,
                force,
            });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_update_document", {
        title: "Actualizar documento",
        description: "Cambia el alias de un documento que subiste. Requiere scope 'write'.",
        inputSchema: {
            documentId: z.string().min(1),
            alias: z
                .string()
                .max(80)
                .nullable()
                .optional()
                .describe("Nuevo alias o null para quitarlo."),
        },
    }, async ({ documentId, alias }) => {
        try {
            const data = await kairoFetch(`/api/documents/${encodeURIComponent(documentId)}`, { method: "PATCH", body: { alias: alias ?? null } });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_delete_document", {
        title: "Eliminar documento",
        description: "Elimina un documento que subiste (y sus firmas asociadas). Requiere scope 'write'.",
        inputSchema: {
            documentId: z.string().min(1),
        },
    }, async ({ documentId }) => {
        try {
            const data = await kairoFetch(`/api/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_revoke_signature", {
        title: "Revocar firma en documento",
        description: "Revoca una firma ya hecha (deja de contar en QR/certificado). Si hay firmas posteriores en la cadena, también se revocan. Requiere scope 'write'. Indicá signatureId o signerName (ej. Roberto Malaver, Mendoza).",
        inputSchema: {
            documentId: z.string().min(1),
            signatureId: z
                .string()
                .min(1)
                .optional()
                .describe("ID de la firma a revocar."),
            signerName: z
                .string()
                .min(1)
                .optional()
                .describe("Nombre del firmante (parcial ok). Obligatorio si no hay signatureId."),
        },
    }, async ({ documentId, signatureId, signerName }) => {
        try {
            const data = await kairoFetch(`/api/documents/${encodeURIComponent(documentId)}/signatures/revoke`, {
                method: "POST",
                body: {
                    ...(signatureId ? { signatureId } : {}),
                    ...(signerName ? { signerName } : {}),
                },
            });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_download_signed_pdf", {
        title: "Descargar PDF firmado",
        description: "Descarga el PDF estampado de una firma. Podés acceder si ves el documento (incluye firmas del estudio).",
        inputSchema: {
            signatureId: z.string().min(1),
        },
    }, async ({ signatureId }) => {
        try {
            const { data, contentType, filename } = await kairoFetchBinary(`/api/signatures/${encodeURIComponent(signatureId)}/download`);
            return ok({
                signatureId,
                filename,
                contentType,
                sizeBytes: data.byteLength,
                base64: Buffer.from(data).toString("base64"),
            });
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_get_signature_certificate", {
        title: "Obtener certificado de firma",
        description: "Devuelve el certificado JSON de una firma (incluye verifyUrl). Requiere ver el documento.",
        inputSchema: {
            signatureId: z.string().min(1),
        },
    }, async ({ signatureId }) => {
        try {
            const { data, filename } = await kairoFetchBinary(`/api/signatures/${encodeURIComponent(signatureId)}/certificate`);
            const text = new TextDecoder().decode(data);
            const certificate = JSON.parse(text);
            return ok({ signatureId, filename, certificate });
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_list_signature_presets", {
        title: "Listar presets de firma",
        description: "Lista la biblioteca de firmas guardadas del usuario (nombre, DNI, CUIL opcionales).",
        inputSchema: {},
    }, async () => {
        try {
            const data = await kairoFetch("/api/signature-presets");
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_create_signature_preset", {
        title: "Crear preset de firma",
        description: "Guarda una firma en la biblioteca. Requiere scope 'write'. La imagen PNG en base64 es obligatoria.",
        inputSchema: {
            signatureImageBase64: z
                .string()
                .min(1)
                .describe("Imagen PNG de la firma (data URL o base64)."),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            dni: z.string().optional(),
            cuil: z.string().optional(),
        },
    }, async ({ signatureImageBase64, firstName, lastName, dni, cuil }) => {
        try {
            const data = await kairoFetch("/api/signature-presets", {
                method: "POST",
                body: { signatureImageBase64, firstName, lastName, dni, cuil },
            });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_update_signature_preset", {
        title: "Actualizar preset de firma",
        description: "Modifica datos y/o imagen de un preset. Requiere scope 'write'.",
        inputSchema: {
            presetId: z.string().min(1),
            signatureImageBase64: z.string().optional(),
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            dni: z.string().optional(),
            cuil: z.string().optional(),
        },
    }, async ({ presetId, signatureImageBase64, firstName, lastName, dni, cuil }) => {
        try {
            const data = await kairoFetch(`/api/signature-presets/${encodeURIComponent(presetId)}`, {
                method: "PATCH",
                body: { signatureImageBase64, firstName, lastName, dni, cuil },
            });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_delete_signature_preset", {
        title: "Eliminar preset de firma",
        description: "Elimina un preset de la biblioteca. Requiere scope 'write'.",
        inputSchema: {
            presetId: z.string().min(1),
        },
    }, async ({ presetId }) => {
        try {
            const data = await kairoFetch(`/api/signature-presets/${encodeURIComponent(presetId)}`, { method: "DELETE" });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_get_studio", {
        title: "Detalle de estudio",
        description: "Obtiene un estudio con áreas, miembros y tu rol.",
        inputSchema: {
            studioId: z.string().min(1),
        },
    }, async ({ studioId }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}`);
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_update_studio", {
        title: "Renombrar estudio",
        description: "Cambia el nombre de un estudio. Requiere rol de gestión y scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
            name: z.string().min(2).max(80),
        },
    }, async ({ studioId, name }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}`, { method: "PATCH", body: { name } });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_delete_studio", {
        title: "Eliminar estudio",
        description: "Elimina un estudio definitivamente. Requiere rol de gestión y scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
        },
    }, async ({ studioId }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}`, { method: "DELETE" });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_create_studio_area", {
        title: "Crear área de estudio",
        description: "Crea un área dentro de un estudio. Requiere gestión y scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
            name: z.string().min(2).max(40),
        },
    }, async ({ studioId, name }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}/areas`, { method: "POST", body: { name } });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_update_studio_area", {
        title: "Renombrar área",
        description: "Cambia el nombre de un área. Requiere gestión y scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
            areaId: z.string().min(1),
            name: z.string().min(2).max(40),
        },
    }, async ({ studioId, areaId, name }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}/areas/${encodeURIComponent(areaId)}`, { method: "PATCH", body: { name } });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_delete_studio_area", {
        title: "Eliminar área",
        description: "Elimina un área del estudio. Los documentos quedan sin área. Requiere scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
            areaId: z.string().min(1),
        },
    }, async ({ studioId, areaId }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}/areas/${encodeURIComponent(areaId)}`, { method: "DELETE" });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_add_studio_member", {
        title: "Agregar miembro al estudio",
        description: "Invita a un usuario registrado por email. Roles: socio o abogado. Requiere scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
            email: z.string().email(),
            role: z.enum(["socio", "abogado"]),
            areaId: z.string().optional().describe("Área asignada (opcional)."),
        },
    }, async ({ studioId, email, role, areaId }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}/members`, { method: "POST", body: { email, role, areaId } });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_update_studio_member", {
        title: "Actualizar miembro del estudio",
        description: "Cambia rol y/o área de un miembro. Requiere scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
            memberId: z.string().min(1),
            role: z.enum(["socio", "abogado"]).optional(),
            areaId: z.string().nullable().optional(),
        },
    }, async ({ studioId, memberId, role, areaId }) => {
        try {
            const body = {};
            if (role !== undefined)
                body.role = role;
            if (areaId !== undefined)
                body.areaId = areaId;
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}/members/${encodeURIComponent(memberId)}`, { method: "PATCH", body });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
    registerAuthTool(server, "kairo_remove_studio_member", {
        title: "Quitar miembro del estudio",
        description: "Elimina a un miembro del estudio. Requiere scope 'write'.",
        inputSchema: {
            studioId: z.string().min(1),
            memberId: z.string().min(1),
        },
    }, async ({ studioId, memberId }) => {
        try {
            const data = await kairoFetch(`/api/studios/${encodeURIComponent(studioId)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
            return ok(data);
        }
        catch (e) {
            return fail(e);
        }
    });
}
