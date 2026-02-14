import type { ModelDefinition, Provider } from "./openclaw.js";

/**
 * Multi-provider model registry.
 * Focuses on top-tier reasoning models that OpenClaws use as substrates.
 */
export const MODEL_REGISTRY: Record<Provider, Record<string, ModelDefinition>> = {
  anthropic: {
    // Claude Opus 4.6 (latest flagship)
    "claude-opus-4-6-20260201": {
      id: "claude-opus-4-6-20260201",
      name: "Claude Opus 4.6",
      provider: "anthropic",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 64000,
      cost: {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
      },
    },

    // Claude Opus 4.5
    "claude-opus-4-5-20251101": {
      id: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      provider: "anthropic",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 64000,
      cost: {
        input: 5,
        output: 25,
        cacheRead: 0.5,
        cacheWrite: 6.25,
      },
    },

    // Claude Sonnet 4.5
    "claude-sonnet-4-5-20250929": {
      id: "claude-sonnet-4-5-20250929",
      name: "Claude Sonnet 4.5",
      provider: "anthropic",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 64000,
      cost: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
    },

    // Claude Haiku 4.5 (internal/trace analysis only)
    "claude-haiku-4-5-20251001": {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      provider: "anthropic",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 64000,
      cost: {
        input: 0.8,
        output: 4,
        cacheRead: 0.08,
        cacheWrite: 1,
      },
    },

    // Legacy models (Claude 3.5)
    "claude-3-5-sonnet-20241022": {
      id: "claude-3-5-sonnet-20241022",
      name: "Claude 3.5 Sonnet",
      provider: "anthropic",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
      cost: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
    },

    // Claude 3 Opus (legacy)
    "claude-3-opus-20240229": {
      id: "claude-3-opus-20240229",
      name: "Claude 3 Opus",
      provider: "anthropic",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 4096,
      cost: {
        input: 15,
        output: 75,
        cacheRead: 1.5,
        cacheWrite: 18.75,
      },
    },

    "claude-3-haiku-20240307": {
      id: "claude-3-haiku-20240307",
      name: "Claude 3 Haiku",
      provider: "anthropic",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 4096,
      cost: {
        input: 0.25,
        output: 1.25,
        cacheRead: 0.03,
        cacheWrite: 0.3,
      },
    },
  },

  openai: {
    "gpt-5.2": {
      id: "gpt-5.2",
      name: "GPT-5.2 Thinking",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
    },

    "gpt-5.2-pro": {
      id: "gpt-5.2-pro",
      name: "GPT-5.2 Pro",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
    },

    "gpt-5": {
      id: "gpt-5",
      name: "GPT-5",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
    },

    "gpt-5-mini": {
      id: "gpt-5-mini",
      name: "GPT-5 Mini",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
    },
  },

  gemini: {
    "gemini-2.5-pro": {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      provider: "gemini",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1000000,
      maxTokens: 64000,
    },

    "gemini-2.5-flash": {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      provider: "gemini",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1000000,
      maxTokens: 64000,
    },

    "gemini-3-pro-preview": {
      id: "gemini-3-pro-preview",
      name: "Gemini 3 Pro",
      provider: "gemini",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 2000000,
      maxTokens: 64000,
    },
  },
};

/**
 * Backward-compatible re-export of Anthropic models.
 */
export const ANTHROPIC_MODELS = MODEL_REGISTRY.anthropic;

/**
 * Detect provider from a model ID string.
 */
export function detectProvider(modelId: string): Provider | null {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4-")
  )
    return "openai";
  if (modelId.startsWith("gemini-")) return "gemini";
  return null;
}

/**
 * Get model definition by ID — searches all providers.
 * Returns the definition if known, or creates a basic one if unknown.
 */
export function getModelDefinition(modelId: string): ModelDefinition {
  // Search all providers
  for (const provider of Object.values(MODEL_REGISTRY)) {
    const known = provider[modelId];
    if (known) return known;
  }

  // Create a basic definition for unknown models
  const detectedProvider = detectProvider(modelId);
  return {
    id: modelId,
    name: formatModelName(modelId),
    provider: detectedProvider ?? undefined,
    reasoning:
      modelId.includes("opus") ||
      modelId.includes("sonnet") ||
      modelId.includes("gpt-5") ||
      modelId.includes("pro"),
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  };
}

/**
 * Check if a model ID is a known model (any provider).
 */
export function isKnownModel(modelId: string): boolean {
  for (const provider of Object.values(MODEL_REGISTRY)) {
    if (modelId in provider) return true;
  }
  return false;
}

/**
 * Check if a model ID looks like an Anthropic model.
 */
export function isAnthropicModel(modelId: string): boolean {
  return modelId.startsWith("claude-");
}

/**
 * Format a model ID into a human-readable name.
 * Handles Anthropic, OpenAI, and Gemini model ID formats.
 */
export function formatModelName(modelId: string): string {
  // First check all known models
  for (const provider of Object.values(MODEL_REGISTRY)) {
    const known = provider[modelId];
    if (known) return known.name;
  }

  // Try provider-specific parsing
  const provider = detectProvider(modelId);

  if (provider === "openai") {
    return formatOpenAIModelName(modelId);
  }

  if (provider === "gemini") {
    return formatGeminiModelName(modelId);
  }

  // Anthropic parsing (default)
  return formatAnthropicModelName(modelId);
}

/**
 * Format Anthropic model ID: claude-opus-4-5-20251101 -> "Claude Opus 4.5"
 */
function formatAnthropicModelName(modelId: string): string {
  const parts = modelId.split("-");
  if (parts[0] !== "claude" || parts.length < 3) {
    return modelId;
  }

  const tier = parts[1];
  const tierCapitalized = tier.charAt(0).toUpperCase() + tier.slice(1);

  // Try to extract version (e.g., "4-5" -> "4.5")
  if (parts.length >= 4 && /^\d+$/.test(parts[2]) && /^\d+$/.test(parts[3])) {
    return `Claude ${tierCapitalized} ${parts[2]}.${parts[3]}`;
  }

  // Fallback for older naming (e.g., claude-3-opus-20240229)
  if (/^\d+$/.test(parts[1])) {
    const version = parts[1];
    const tierName = parts[2];
    const tierCap = tierName.charAt(0).toUpperCase() + tierName.slice(1);
    return `Claude ${version} ${tierCap}`;
  }

  return `Claude ${tierCapitalized}`;
}

/**
 * Format OpenAI model ID: gpt-5.2 -> "GPT-5.2 Thinking", gpt-5-mini -> "GPT-5 Mini"
 */
function formatOpenAIModelName(modelId: string): string {
  // Handle o-series models
  if (modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("o4")) {
    return modelId.toUpperCase().replace(/-/g, " ");
  }

  // Handle gpt- models
  const withoutGpt = modelId.replace(/^gpt-/, "");
  const parts = withoutGpt.split("-");

  // gpt-5.2 -> "GPT-5.2 Thinking", gpt-5.2-pro -> "GPT-5.2 Pro"
  const version = parts[0]; // e.g., "5.2" or "5"
  const suffix = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

  if (suffix) {
    return `GPT-${version} ${suffix}`;
  }
  return `GPT-${version}`;
}

/**
 * Format Gemini model ID: gemini-2.5-pro -> "Gemini 2.5 Pro"
 */
function formatGeminiModelName(modelId: string): string {
  const withoutGemini = modelId.replace(/^gemini-/, "");
  const parts = withoutGemini.split("-");

  // gemini-2.5-pro -> version="2.5", rest="pro"
  // gemini-3-pro-preview -> version="3", rest="pro preview"
  const version = parts[0];
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

  return `Gemini ${version} ${rest}`.trim();
}

/**
 * Get all known model IDs across all providers.
 */
export function getAllKnownModelIds(): string[] {
  const ids: string[] = [];
  for (const provider of Object.values(MODEL_REGISTRY)) {
    ids.push(...Object.keys(provider));
  }
  return ids;
}

/**
 * Get the latest models per provider.
 * Returns { anthropic: [...], openai: [...], gemini: [...] }
 */
export function getLatestModels(): Record<Provider, ModelDefinition[]> {
  return {
    anthropic: [
      MODEL_REGISTRY.anthropic["claude-opus-4-6-20260201"],
      MODEL_REGISTRY.anthropic["claude-opus-4-5-20251101"],
      MODEL_REGISTRY.anthropic["claude-sonnet-4-5-20250929"],
    ],
    openai: [
      MODEL_REGISTRY.openai["gpt-5.2"],
      MODEL_REGISTRY.openai["gpt-5.2-pro"],
      MODEL_REGISTRY.openai["gpt-5"],
      MODEL_REGISTRY.openai["gpt-5-mini"],
    ],
    gemini: [
      MODEL_REGISTRY.gemini["gemini-2.5-pro"],
      MODEL_REGISTRY.gemini["gemini-2.5-flash"],
      MODEL_REGISTRY.gemini["gemini-3-pro-preview"],
    ],
  };
}
