import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default test run: unit tests only (exclude integration + bench)
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/src/__tests__/integration/**',
      '**/src/__tests__/bench/**',
    ],
  },
});
