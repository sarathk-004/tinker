import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // One throwaway Postgres cluster per run (never the dev database); see test/support/global-setup.ts.
    globalSetup: ['./test/support/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
