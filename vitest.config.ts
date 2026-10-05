import { defineConfig } from 'vitest/config';

// Frontend logic tests (api client, document session, adapters). Workspace packages have their own vitest configs.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
