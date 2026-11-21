import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@sentry/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@sentry/ui': resolve(__dirname, 'packages/ui/src/index.ts'),
    },
  },
});
