import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// OpenClaw paths
export const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");
export const OPENCLAW_CONFIG_FILE = path.join(OPENCLAW_DIR, "openclaw.json");
export const AUTH_PROFILES_FILE = path.join(
  OPENCLAW_DIR,
  "agents",
  "main",
  "agent",
  "auth-profiles.json"
);

// Type definitions for OpenClaw config structures
export interface AuthProfile {
  type: "api_key" | "oauth";
  provider: string;
  key?: string; // Only present for api_key type
}

export interface AuthProfilesFile {
  version: number;
  profiles: Record<string, AuthProfile>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, unknown>;
}

export interface ModelDefinition {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

export interface SmoltbotProvider {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: ModelDefinition[];
}

export interface OpenClawConfig {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  wizard?: Record<string, unknown>;
  update?: Record<string, unknown>;
  auth?: {
    profiles?: Record<string, { provider: string; mode: string }>;
  };
  models?: {
    mode?: string;
    providers?: Record<string, SmoltbotProvider>;
  };
  agents?: {
    defaults?: {
      workspace?: string;
      compaction?: Record<string, unknown>;
      maxConcurrent?: number;
      subagents?: Record<string, unknown>;
      model?: {
        primary?: string;
      };
      models?: Record<string, unknown>;
    };
  };
  messages?: Record<string, unknown>;
  commands?: Record<string, unknown>;
  gateway?: Record<string, unknown>;
  [key: string]: unknown; // Allow other unknown fields
}

export interface OpenClawDetectionResult {
  installed: boolean;
  hasApiKey: boolean;
  isOAuth: boolean;
  apiKey?: string;
  currentModel?: string;
  currentModelId?: string; // Just the model ID without provider prefix
  currentProvider?: string; // The provider prefix (e.g., "anthropic" or "smoltbot")
  smoltbotAlreadyConfigured: boolean;
  error?: string;
}

/**
 * Check if OpenClaw is installed
 */
export function openclawExists(): boolean {
  return fs.existsSync(OPENCLAW_DIR) && fs.existsSync(OPENCLAW_CONFIG_FILE);
}

/**
 * Load and parse auth-profiles.json
 */
export function loadAuthProfiles(): AuthProfilesFile | null {
  if (!fs.existsSync(AUTH_PROFILES_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(AUTH_PROFILES_FILE, "utf-8");
    return JSON.parse(content) as AuthProfilesFile;
  } catch {
    return null;
  }
}

/**
 * Get the Anthropic API key from auth-profiles.json
 */
export function getAnthropicApiKey(): { key: string | null; isOAuth: boolean } {
  const profiles = loadAuthProfiles();
  if (!profiles) {
    return { key: null, isOAuth: false };
  }

  // Look for anthropic:default or any anthropic profile
  const anthropicProfile =
    profiles.profiles["anthropic:default"] ||
    Object.values(profiles.profiles).find((p) => p.provider === "anthropic");

  if (!anthropicProfile) {
    return { key: null, isOAuth: false };
  }

  if (anthropicProfile.type === "oauth" || !anthropicProfile.key) {
    return { key: null, isOAuth: true };
  }

  return { key: anthropicProfile.key, isOAuth: false };
}

/**
 * Load openclaw.json config
 */
export function loadOpenClawConfig(): OpenClawConfig | null {
  if (!fs.existsSync(OPENCLAW_CONFIG_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(OPENCLAW_CONFIG_FILE, "utf-8");
    return JSON.parse(content) as OpenClawConfig;
  } catch {
    return null;
  }
}

/**
 * Save openclaw.json config (preserves all existing fields)
 */
export function saveOpenClawConfig(config: OpenClawConfig): void {
  // Update meta timestamp
  if (!config.meta) {
    config.meta = {};
  }
  config.meta.lastTouchedAt = new Date().toISOString();

  fs.writeFileSync(OPENCLAW_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get the current default model from OpenClaw config
 * Returns both the full model path (provider/model) and parsed parts
 */
export function getCurrentModel(): {
  fullPath: string | null;
  provider: string | null;
  modelId: string | null;
} {
  const config = loadOpenClawConfig();
  if (!config) {
    return { fullPath: null, provider: null, modelId: null };
  }

  const primary = config.agents?.defaults?.model?.primary;
  if (!primary) {
    return { fullPath: null, provider: null, modelId: null };
  }

  // Parse provider/model format (e.g., "anthropic/claude-opus-4-5-20251101")
  const parts = primary.split("/");
  if (parts.length === 2) {
    return {
      fullPath: primary,
      provider: parts[0],
      modelId: parts[1],
    };
  }

  // No provider prefix, assume it's just the model ID
  return {
    fullPath: primary,
    provider: null,
    modelId: primary,
  };
}

/**
 * Check if smoltbot provider is already configured
 */
export function isSmoltbotConfigured(): boolean {
  const config = loadOpenClawConfig();
  return !!config?.models?.providers?.smoltbot;
}

/**
 * Get the existing smoltbot provider config
 */
export function getSmoltbotProvider(): SmoltbotProvider | null {
  const config = loadOpenClawConfig();
  return config?.models?.providers?.smoltbot || null;
}

/**
 * Comprehensive detection of OpenClaw setup
 */
export function detectOpenClaw(): OpenClawDetectionResult {
  // Check if OpenClaw is installed
  if (!openclawExists()) {
    return {
      installed: false,
      hasApiKey: false,
      isOAuth: false,
      smoltbotAlreadyConfigured: false,
      error: "OpenClaw is not installed. Install from https://openclaw.ai",
    };
  }

  // Check auth profile
  const { key, isOAuth } = getAnthropicApiKey();

  if (isOAuth) {
    return {
      installed: true,
      hasApiKey: false,
      isOAuth: true,
      smoltbotAlreadyConfigured: isSmoltbotConfigured(),
      error:
        "OAuth authentication detected. smoltbot only supports API key authentication.\n" +
        "To use smoltbot, add an API key to your Anthropic auth profile.",
    };
  }

  if (!key) {
    return {
      installed: true,
      hasApiKey: false,
      isOAuth: false,
      smoltbotAlreadyConfigured: isSmoltbotConfigured(),
      error:
        "No Anthropic API key found in auth-profiles.json.\n" +
        "Run `openclaw auth` to configure your API key.",
    };
  }

  // Get current model
  const { fullPath, provider, modelId } = getCurrentModel();

  return {
    installed: true,
    hasApiKey: true,
    isOAuth: false,
    apiKey: key,
    currentModel: fullPath || undefined,
    currentModelId: modelId || undefined,
    currentProvider: provider || undefined,
    smoltbotAlreadyConfigured: isSmoltbotConfigured(),
  };
}

/**
 * Configure the smoltbot provider in OpenClaw config
 */
export function configureSmoltbotProvider(
  apiKey: string,
  models: ModelDefinition[]
): void {
  const config = loadOpenClawConfig();
  if (!config) {
    throw new Error("Could not load OpenClaw config");
  }

  // Ensure models section exists
  if (!config.models) {
    config.models = {};
  }
  if (!config.models.providers) {
    config.models.providers = {};
  }

  // Set mode to merge if not set
  if (!config.models.mode) {
    config.models.mode = "merge";
  }

  // Configure smoltbot provider
  config.models.providers.smoltbot = {
    baseUrl: "https://gateway.mnemom.ai/anthropic",
    apiKey: apiKey,
    api: "anthropic-messages",
    models: models,
  };

  saveOpenClawConfig(config);
}

/**
 * Set the default model in OpenClaw config
 */
export function setDefaultModel(modelPath: string): void {
  const config = loadOpenClawConfig();
  if (!config) {
    throw new Error("Could not load OpenClaw config");
  }

  // Ensure agents.defaults.model section exists
  if (!config.agents) {
    config.agents = {};
  }
  if (!config.agents.defaults) {
    config.agents.defaults = {};
  }
  if (!config.agents.defaults.model) {
    config.agents.defaults.model = {};
  }

  // Also add to models map if not present
  if (!config.agents.defaults.models) {
    config.agents.defaults.models = {};
  }

  config.agents.defaults.model.primary = modelPath;
  config.agents.defaults.models[modelPath] = {};

  saveOpenClawConfig(config);
}
