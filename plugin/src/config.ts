import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Plugin configuration interface
 */
export interface SmoltbotConfig {
  agentId: string;
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
  batchSize: number;
  timeout: number;
}

/**
 * Configuration stored in ~/.smoltbot/config.json
 */
export interface StoredConfig {
  agentId: string;
  createdAt: string;
  version: string;
}

/**
 * Path to the smoltbot configuration directory
 */
export const CONFIG_DIR = join(homedir(), '.smoltbot');

/**
 * Path to the configuration file
 */
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/**
 * Default API URL (can be overridden by environment variable)
 * Points to Supabase REST API - user must set their project URL
 */
const DEFAULT_API_URL = '';

/**
 * Load stored configuration from disk
 */
export function loadStoredConfig(): StoredConfig | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as StoredConfig;
  } catch {
    return null;
  }
}

/**
 * Get the full plugin configuration from environment and config file
 */
export function getConfig(): SmoltbotConfig | null {
  const storedConfig = loadStoredConfig();

  if (!storedConfig) {
    console.warn('[smoltbot] No configuration found. Run "smoltbot init" to initialize.');
    return null;
  }

  const apiUrl = process.env.SMOLTBOT_API_URL || DEFAULT_API_URL;
  const apiKey = process.env.SMOLTBOT_API_KEY || '';
  const enabled = process.env.SMOLTBOT_ENABLED !== 'false';
  const batchSize = parseInt(process.env.SMOLTBOT_BATCH_SIZE || '1', 10);
  const timeout = parseInt(process.env.SMOLTBOT_TIMEOUT || '5000', 10);

  if (!apiUrl) {
    console.warn('[smoltbot] SMOLTBOT_API_URL not set. Traces will not be submitted.');
  }

  if (!apiKey) {
    console.warn('[smoltbot] SMOLTBOT_API_KEY not set. Traces will not be submitted.');
  }

  return {
    agentId: storedConfig.agentId,
    apiUrl,
    apiKey,
    enabled: enabled && !!apiUrl && !!apiKey,
    batchSize,
    timeout,
  };
}

/**
 * Get the agent dashboard URL
 */
export function getAgentUrl(agentId: string): string {
  return `https://mnemom.ai/agent/${agentId}`;
}
