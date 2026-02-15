import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

export const CONFIG_DIR = path.join(os.homedir(), ".smoltbot");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface Config {
  agentId: string;
  email?: string;
  gateway?: string;
  openclawConfigured?: boolean;
  providers?: string[];  // e.g. ['anthropic', 'openai'] — standalone mode
  configuredAt?: string;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): Config | null {
  if (!configExists()) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as Config;
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function generateAgentId(): string {
  const randomHex = crypto.randomBytes(4).toString("hex");
  return `smolt-${randomHex}`;
}

/**
 * Derive agent ID deterministically from an API key.
 * Uses the same SHA-256 hashing as the gateway so IDs match.
 */
export function deriveAgentId(apiKey: string): string {
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const agentHash = hash.substring(0, 16);
  return `smolt-${agentHash.slice(0, 8)}`;
}
