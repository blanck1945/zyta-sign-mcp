import { requireAuth } from "../client.js";
import { fail } from "./results.js";
/** Registra una herramienta que exige sesión activa (patrón boogiepop-dashboard-mcp). */
export function registerAuthTool(server, name, config, handler) {
    server.registerTool(name, config, (async (...args) => {
        try {
            await requireAuth();
            return await handler(...args);
        }
        catch (e) {
            return fail(e);
        }
    }));
}
