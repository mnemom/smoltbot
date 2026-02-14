import { describe, it, expect } from "vitest";

import {
  ANTHROPIC_MODELS,
  MODEL_REGISTRY,
  getModelDefinition,
  isKnownModel,
  isAnthropicModel,
  formatModelName,
  getAllKnownModelIds,
  getLatestModels,
  detectProvider,
} from "../lib/models.js";

describe("models", () => {
  describe("ANTHROPIC_MODELS", () => {
    it("should contain Claude Opus 4.5", () => {
      const opus = ANTHROPIC_MODELS["claude-opus-4-5-20251101"];

      expect(opus).toBeDefined();
      expect(opus.name).toBe("Claude Opus 4.5");
      expect(opus.reasoning).toBe(true);
      expect(opus.contextWindow).toBe(200000);
      expect(opus.maxTokens).toBe(64000);
    });

    it("should contain Claude Sonnet 4.5", () => {
      const sonnet = ANTHROPIC_MODELS["claude-sonnet-4-5-20250929"];

      expect(sonnet).toBeDefined();
      expect(sonnet.name).toBe("Claude Sonnet 4.5");
      expect(sonnet.reasoning).toBe(true);
    });

    it("should contain Claude Haiku 4.5", () => {
      const haiku = ANTHROPIC_MODELS["claude-haiku-4-5-20251001"];

      expect(haiku).toBeDefined();
      expect(haiku.name).toBe("Claude Haiku 4.5");
      expect(haiku.reasoning).toBe(false);
    });

    it("should contain legacy models", () => {
      expect(ANTHROPIC_MODELS["claude-3-5-sonnet-20241022"]).toBeDefined();
      expect(ANTHROPIC_MODELS["claude-haiku-4-5-20251001"]).toBeDefined();
      expect(ANTHROPIC_MODELS["claude-3-opus-20240229"]).toBeDefined();
      expect(ANTHROPIC_MODELS["claude-3-haiku-20240307"]).toBeDefined();
    });

    it("should have cost information for all models", () => {
      for (const [id, model] of Object.entries(ANTHROPIC_MODELS)) {
        expect(model.cost).toBeDefined();
        expect(model.cost?.input).toBeGreaterThan(0);
        expect(model.cost?.output).toBeGreaterThan(0);
      }
    });
  });

  describe("getModelDefinition", () => {
    it("should return known model definition", () => {
      const model = getModelDefinition("claude-opus-4-5-20251101");

      expect(model.id).toBe("claude-opus-4-5-20251101");
      expect(model.name).toBe("Claude Opus 4.5");
      expect(model.reasoning).toBe(true);
    });

    it("should create basic definition for unknown model", () => {
      const model = getModelDefinition("claude-future-model-20260101");

      expect(model.id).toBe("claude-future-model-20260101");
      expect(model.contextWindow).toBe(200000);
      expect(model.maxTokens).toBe(64000);
    });

    it("should infer reasoning capability for unknown opus/sonnet models", () => {
      const opus = getModelDefinition("claude-opus-9-20280101");
      const sonnet = getModelDefinition("claude-sonnet-9-20280101");
      const haiku = getModelDefinition("claude-haiku-9-20280101");

      expect(opus.reasoning).toBe(true);
      expect(sonnet.reasoning).toBe(true);
      expect(haiku.reasoning).toBe(false);
    });
  });

  describe("isKnownModel", () => {
    it("should return true for known models", () => {
      expect(isKnownModel("claude-opus-4-5-20251101")).toBe(true);
      expect(isKnownModel("claude-sonnet-4-5-20250929")).toBe(true);
      expect(isKnownModel("claude-3-haiku-20240307")).toBe(true);
    });

    it("should return false for unknown models", () => {
      expect(isKnownModel("claude-future-model")).toBe(false);
      expect(isKnownModel("gpt-4")).toBe(false);
      expect(isKnownModel("")).toBe(false);
    });
  });

  describe("isAnthropicModel", () => {
    it("should return true for claude models", () => {
      expect(isAnthropicModel("claude-opus-4-5-20251101")).toBe(true);
      expect(isAnthropicModel("claude-3-haiku-20240307")).toBe(true);
      expect(isAnthropicModel("claude-future")).toBe(true);
    });

    it("should return false for non-claude models", () => {
      expect(isAnthropicModel("gpt-4")).toBe(false);
      expect(isAnthropicModel("gemini-pro")).toBe(false);
      expect(isAnthropicModel("")).toBe(false);
    });
  });

  describe("formatModelName", () => {
    it("should return known model names", () => {
      expect(formatModelName("claude-opus-4-5-20251101")).toBe("Claude Opus 4.5");
      expect(formatModelName("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
      expect(formatModelName("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    });

    it("should format unknown models with version", () => {
      expect(formatModelName("claude-opus-5-0-20270101")).toBe("Claude Opus 5.0");
      expect(formatModelName("claude-sonnet-6-1-20280101")).toBe("Claude Sonnet 6.1");
    });

    it("should format legacy style model names", () => {
      expect(formatModelName("claude-3-opus-20240229")).toBe("Claude 3 Opus");
      expect(formatModelName("claude-3-sonnet-20240229")).toBe("Claude 3 Sonnet");
    });

    it("should return model ID for unparseable names", () => {
      expect(formatModelName("some-random-model")).toBe("some-random-model");
    });

    it("should format OpenAI model names", () => {
      expect(formatModelName("gpt-5.2")).toBe("GPT-5.2 Thinking");
      expect(formatModelName("gpt-5.2-pro")).toBe("GPT-5.2 Pro");
      expect(formatModelName("gpt-5-mini")).toBe("GPT-5 Mini");
    });

    it("should format Gemini model names", () => {
      expect(formatModelName("gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
      expect(formatModelName("gemini-3-pro-preview")).toBe("Gemini 3 Pro");
    });
  });

  describe("getAllKnownModelIds", () => {
    it("should return array of model IDs", () => {
      const ids = getAllKnownModelIds();

      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).toContain("claude-opus-4-5-20251101");
      expect(ids).toContain("claude-sonnet-4-5-20250929");
      expect(ids).toContain("claude-haiku-4-5-20251001");
    });
  });

  describe("getLatestModels", () => {
    it("should return latest models per provider", () => {
      const latest = getLatestModels();

      expect(latest.anthropic.length).toBeGreaterThanOrEqual(3);
      expect(latest.openai.length).toBeGreaterThanOrEqual(3);
      expect(latest.gemini.length).toBeGreaterThanOrEqual(2);

      const anthropicIds = latest.anthropic.map((m) => m.id);
      expect(anthropicIds).toContain("claude-opus-4-5-20251101");
      expect(anthropicIds).toContain("claude-sonnet-4-5-20250929");
    });

    it("should return full model definitions for each provider", () => {
      const latest = getLatestModels();

      for (const models of Object.values(latest)) {
        for (const model of models) {
          expect(model.id).toBeDefined();
          expect(model.name).toBeDefined();
          expect(model.contextWindow).toBeDefined();
          expect(model.maxTokens).toBeDefined();
        }
      }
    });
  });

  describe("detectProvider", () => {
    it("should detect Anthropic models", () => {
      expect(detectProvider("claude-opus-4-5-20251101")).toBe("anthropic");
      expect(detectProvider("claude-3-haiku-20240307")).toBe("anthropic");
    });

    it("should detect OpenAI models", () => {
      expect(detectProvider("gpt-5.2")).toBe("openai");
      expect(detectProvider("gpt-5-mini")).toBe("openai");
      expect(detectProvider("o3")).toBe("openai");
      expect(detectProvider("o4-mini")).toBe("openai");
    });

    it("should detect Gemini models", () => {
      expect(detectProvider("gemini-2.5-pro")).toBe("gemini");
      expect(detectProvider("gemini-3-pro-preview")).toBe("gemini");
    });

    it("should return null for unknown models", () => {
      expect(detectProvider("unknown-model")).toBeNull();
      expect(detectProvider("llama-3")).toBeNull();
    });
  });

  describe("MODEL_REGISTRY", () => {
    it("should have entries for all providers", () => {
      expect(Object.keys(MODEL_REGISTRY.anthropic).length).toBeGreaterThan(0);
      expect(Object.keys(MODEL_REGISTRY.openai).length).toBeGreaterThan(0);
      expect(Object.keys(MODEL_REGISTRY.gemini).length).toBeGreaterThan(0);
    });

    it("should include OpenAI GPT-5 models", () => {
      expect(MODEL_REGISTRY.openai["gpt-5.2"]).toBeDefined();
      expect(MODEL_REGISTRY.openai["gpt-5"]).toBeDefined();
      expect(MODEL_REGISTRY.openai["gpt-5.2"].reasoning).toBe(true);
    });

    it("should include Gemini models", () => {
      expect(MODEL_REGISTRY.gemini["gemini-2.5-pro"]).toBeDefined();
      expect(MODEL_REGISTRY.gemini["gemini-3-pro-preview"]).toBeDefined();
      expect(MODEL_REGISTRY.gemini["gemini-2.5-pro"].reasoning).toBe(true);
    });
  });
});
