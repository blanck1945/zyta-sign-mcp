import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export type KairoDeviceAuthComplete = {
  authorizedAt: string;
  userName: string | null;
  userEmail: string | null;
  clientLabel: string | null;
  scopes: string[];
  source: "browser" | "mcp";
};

function projectRoot(): string {
  if (process.env.KAIRO_PROJECT_ROOT?.trim()) {
    return process.env.KAIRO_PROJECT_ROOT.trim().replace(/\/$/, "");
  }
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, ".cursor", "mcp.json"))) return cwd;
  const parent = path.resolve(cwd, "..");
  if (existsSync(path.join(parent, ".cursor", "mcp.json"))) return parent;
  return cwd;
}

export function deviceAuthNotifyPath(): string {
  return path.join(projectRoot(), ".cursor", "kairo-auth-complete.json");
}

export function writeDeviceAuthComplete(data: KairoDeviceAuthComplete): void {
  const file = deviceAuthNotifyPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
