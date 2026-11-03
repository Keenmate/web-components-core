import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // `npm run test:coverage` — measured, not reasoned about (review 2026-11-03).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test-util.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
