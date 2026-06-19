import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const baseUrl = process.env.KAIRO_BASE_URL ?? "http://localhost:3000";
const token = process.env.KAIRO_API_TOKEN?.trim();
if (!token) {
  console.error("Set KAIRO_API_TOKEN (ej. desde scripts/print-test-token.ts)");
  process.exit(1);
}

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/server.ts"],
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      KAIRO_BASE_URL: baseUrl,
    },
  });

  const client = new Client({ name: "kairo-smoke", version: "0.0.1" });
  await client.connect(transport);

  const login = await client.callTool({
    name: "kairo_login",
    arguments: { access_token: token },
  });
  console.log("[mcp-smoke] kairo_login:", JSON.stringify(login, null, 2));

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log("[mcp-smoke] tools:", names.join(", "));
  if (names.length < 45) {
    throw new Error(`Se esperaban al menos 45 tools, hay ${names.length}`);
  }

  const whoami = await client.callTool({ name: "kairo_whoami", arguments: {} });
  console.log("[mcp-smoke] kairo_whoami:", JSON.stringify(whoami, null, 2));

  const docs = await client.callTool({
    name: "kairo_list_documents",
    arguments: {},
  });
  const docsText =
    docs.content?.[0] && "text" in docs.content[0]
      ? docs.content[0].text.slice(0, 300)
      : "(sin texto)";
  console.log("[mcp-smoke] kairo_list_documents (preview):", docsText);

  const presets = await client.callTool({
    name: "kairo_list_signature_presets",
    arguments: {},
  });
  console.log(
    "[mcp-smoke] kairo_list_signature_presets:",
    presets.content?.[0] && "text" in presets.content[0]
      ? presets.content[0].text.slice(0, 200)
      : "(sin texto)",
  );

  await client.close();
  console.log("[mcp-smoke] OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
