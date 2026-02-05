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
