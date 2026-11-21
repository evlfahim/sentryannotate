import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    // Prefer TypeScript sources over stale compiled .js files that may sit
    // next to them (e.g. packages/core/src/*.js from an earlier tsc run).
    extensions: ['.ts', '.mts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    alias: {
      '@sentry/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@sentry/ui': resolve(__dirname, 'packages/ui/src/index.ts'),
    },
  },
});
