import { z } from "zod";
export const placementSchema = z
    .object({
    mode: z.enum(["label", "fields"]),
    page: z.number().int().min(1).max(1000).optional(),
    xPct: z.number().min(0).max(1).optional(),
    yPct: z.number().min(0).max(1).optional(),
    widthPct: z.number().min(0.005).max(1).optional(),
    fields: z
        .array(z.object({
        id: z.string().optional(),
        type: z.enum(["signature", "qr", "name", "date", "text"]),
        page: z.number().int().min(1).max(1000),
        xPct: z.number().min(0).max(1),
        yPct: z.number().min(0).max(1),
        widthPct: z.number().min(0.005).max(1),
        heightPct: z.number().min(0.005).max(1).optional(),
        text: z.string().max(200).optional(),
    }))
        .optional(),
})
    .optional()
    .describe("Ubicación de campos en el PDF.");
export const externalSignCommonSchema = {
    recipientName: z.string().optional(),
    recipientEmail: z.string().email().optional(),
    inviteMessage: z.string().max(500).optional(),
    sendEmail: z.boolean().optional(),
    placement: placementSchema,
};
export function externalSignRequestBody(args) {
    const body = {
        sendEmail: args.sendEmail ?? false,
    };
    if (args.recipientName?.trim())
        body.recipientName = args.recipientName.trim();
    if (args.recipientEmail?.trim())
        body.recipientEmail = args.recipientEmail.trim();
    if (args.inviteMessage?.trim())
        body.inviteMessage = args.inviteMessage.trim();
    if (args.placement)
        body.placement = args.placement;
    return body;
}
