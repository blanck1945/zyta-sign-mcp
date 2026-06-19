export function buildShareLinks(input) {
    const greeting = input.recipientName
        ? `Hola ${input.recipientName}, `
        : "Hola, ";
    const docPart = input.documentName
        ? ` te envío "${input.documentName}" para firmar en Zyta Firma.`
        : " te envío un documento para firmar en Zyta Firma.";
    const custom = input.inviteMessage?.trim()
        ? `\n\n${input.inviteMessage.trim()}`
        : "";
    const text = `${greeting}${docPart}${custom}\n\n${input.url}`;
    const encoded = encodeURIComponent(text);
    const mailtoShareUrl = input.recipientEmail
        ? `mailto:${encodeURIComponent(input.recipientEmail)}?subject=${encodeURIComponent("Documento para firmar — Zyta Firma")}&body=${encoded}`
        : null;
    return {
        whatsappShareUrl: `https://wa.me/?text=${encoded}`,
        telegramShareUrl: `https://t.me/share/url?url=${encodeURIComponent(input.url)}&text=${encoded}`,
        mailtoShareUrl,
    };
}
export function enrichExternalSignResponse(payload, share) {
    return {
        ...payload,
        ...share,
        shareHint: "Compartí manualmente por WhatsApp/Telegram o usá whatsappShareUrl / telegramShareUrl.",
    };
}
