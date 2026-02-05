import type { ModelDefinition } from "./openclaw.js";

/**
 * Known Anthropic model definitions with their specifications.
 * These are used when configuring the smoltbot provider.
 */
export const ANTHROPIC_MODELS: Record<string, ModelDefinition> = {
  // Claude Opus 4.5 (latest flagship)
  "claude-opus-4-5-20251101": {
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5",
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

  // Claude Haiku 4.5
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
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

  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 8192,
    cost: {
      input: 0.8,
      output: 4,
      cacheRead: 0.08,
      cacheWrite: 1,
    },
  },

  // Claude 3 Opus (legacy)
  "claude-3-opus-20240229": {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus",
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
};

/**
 * Get model definition by ID
 * Returns the definition if known, or creates a basic one if unknown
 */
export function getModelDefinition(modelId: string): ModelDefinition {
  const known = ANTHROPIC_MODELS[modelId];
  if (known) {
    return known;
  }

  // Create a basic definition for unknown models
  // This allows smoltbot to work with new models not yet in our registry
  return {
    id: modelId,
    name: formatModelName(modelId),
    reasoning: modelId.includes("opus") || modelId.includes("sonnet"),
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
  };
}

/**
 * Check if a model ID is a known Anthropic model
 */
export function isKnownModel(modelId: string): boolean {
  return modelId in ANTHROPIC_MODELS;
}

/**
 * Check if a model ID looks like an Anthropic model
 */
export function isAnthropicModel(modelId: string): boolean {
  return modelId.startsWith("claude-");
}

/**
 * Format a model ID into a human-readable name
 * e.g., "claude-opus-4-5-20251101" -> "Claude Opus 4.5"
 */
export function formatModelName(modelId: string): string {
  // First check known models
  const known = ANTHROPIC_MODELS[modelId];
  if (known) {
    return known.name;
  }

  // Try to parse the model ID
  // Pattern: claude-{tier}-{version}-{date}
  // e.g., claude-opus-4-5-20251101

  const parts = modelId.split("-");
  if (parts[0] !== "claude" || parts.length < 3) {
    return modelId; // Return as-is if we can't parse
  }

  const tier = parts[1]; // opus, sonnet, haiku
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
 * Get all known model IDs
 */
export function getAllKnownModelIds(): string[] {
  return Object.keys(ANTHROPIC_MODELS);
}

/**
 * Get the latest model for each tier
 */
export function getLatestModels(): ModelDefinition[] {
  return [
    ANTHROPIC_MODELS["claude-opus-4-5-20251101"],
    ANTHROPIC_MODELS["claude-sonnet-4-5-20250929"],
    ANTHROPIC_MODELS["claude-haiku-4-5-20251001"],
  ];
}
