import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireAuth } from "../client.js";
import { fail } from "./results.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (...args: any[]) => unknown | Promise<unknown>;

/** Registra una herramienta que exige sesión activa (patrón boogiepop-dashboard-mcp). */
export function registerAuthTool(
  server: McpServer,
  name: string,
  config: Record<string, unknown>,
  handler: ToolHandler,
): void {
  server.registerTool(
    name,
    config as Parameters<McpServer["registerTool"]>[1],
    (async (...args: unknown[]) => {
      try {
        await requireAuth();
        return await handler(...args);
      } catch (e) {
        return fail(e);
      }
    }) as Parameters<McpServer["registerTool"]>[2],
  );
}
