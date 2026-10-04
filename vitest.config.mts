import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Tests run in Node (server), so the `server-only` boundary marker resolves to
// its no-op entry. Production client bundles still throw on such imports.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
