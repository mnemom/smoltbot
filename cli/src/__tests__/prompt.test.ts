import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock readline before importing
vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn(),
  })),
}));

import * as readline from "node:readline";
import { askYesNo, isInteractive } from "../lib/prompt.js";

describe("prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("askYesNo", () => {
    it("should return true when user answers 'y'", async () => {
      const mockQuestion = vi.fn((_, callback) => callback("y"));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?");

      expect(result).toBe(true);
      expect(mockClose).toHaveBeenCalled();
    });

    it("should return true when user answers 'yes'", async () => {
      const mockQuestion = vi.fn((_, callback) => callback("yes"));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?");

      expect(result).toBe(true);
    });

    it("should return true when user answers 'Y'", async () => {
      const mockQuestion = vi.fn((_, callback) => callback("Y"));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?");

      expect(result).toBe(true);
    });

    it("should return false when user answers 'n'", async () => {
      const mockQuestion = vi.fn((_, callback) => callback("n"));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?");

      expect(result).toBe(false);
    });

    it("should return false when user answers 'no'", async () => {
      const mockQuestion = vi.fn((_, callback) => callback("no"));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?");

      expect(result).toBe(false);
    });

    it("should return default (true) when user presses enter with defaultYes=true", async () => {
      const mockQuestion = vi.fn((_, callback) => callback(""));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?", true);

      expect(result).toBe(true);
    });

    it("should return default (false) when user presses enter with defaultYes=false", async () => {
      const mockQuestion = vi.fn((_, callback) => callback(""));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?", false);

      expect(result).toBe(false);
    });

    it("should return default when user enters invalid input", async () => {
      const mockQuestion = vi.fn((_, callback) => callback("maybe"));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?", true);

      expect(result).toBe(true);
    });

    it("should trim whitespace from input", async () => {
      const mockQuestion = vi.fn((_, callback) => callback("  y  "));
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      const result = await askYesNo("Test question?");

      expect(result).toBe(true);
    });

    it("should include [Y/n] suffix when defaultYes is true", async () => {
      let questionText = "";
      const mockQuestion = vi.fn((text, callback) => {
        questionText = text;
        callback("");
      });
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      await askYesNo("Continue?", true);

      expect(questionText).toContain("[Y/n]");
    });

    it("should include [y/N] suffix when defaultYes is false", async () => {
      let questionText = "";
      const mockQuestion = vi.fn((text, callback) => {
        questionText = text;
        callback("");
      });
      const mockClose = vi.fn();

      vi.mocked(readline.createInterface).mockReturnValue({
        question: mockQuestion,
        close: mockClose,
      } as unknown as readline.Interface);

      await askYesNo("Continue?", false);

      expect(questionText).toContain("[y/N]");
    });
  });

  describe("isInteractive", () => {
    it("should return true when stdin is a TTY", () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });

      const result = isInteractive();

      expect(result).toBe(true);

      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    });

    it("should return false when stdin is not a TTY", () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });

      const result = isInteractive();

      expect(result).toBe(false);

      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    });

    it("should return false when stdin.isTTY is undefined", () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true });

      const result = isInteractive();

      expect(result).toBe(false);

      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    });
  });
});
