import { describe, it, expect } from "vitest";

import {
  ANTHROPIC_MODELS,
  getModelDefinition,
  isKnownModel,
  isAnthropicModel,
  formatModelName,
  getAllKnownModelIds,
  getLatestModels,
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
      expect(ANTHROPIC_MODELS["claude-3-5-haiku-20241022"]).toBeDefined();
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
      expect(formatModelName("gpt-4")).toBe("gpt-4");
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
    it("should return latest model for each tier", () => {
      const latest = getLatestModels();

      expect(latest.length).toBe(3);

      const ids = latest.map((m) => m.id);
      expect(ids).toContain("claude-opus-4-5-20251101");
      expect(ids).toContain("claude-sonnet-4-5-20250929");
      expect(ids).toContain("claude-haiku-4-5-20251001");
    });

    it("should return full model definitions", () => {
      const latest = getLatestModels();

      for (const model of latest) {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.contextWindow).toBeDefined();
        expect(model.maxTokens).toBeDefined();
      }
    });
  });
});
