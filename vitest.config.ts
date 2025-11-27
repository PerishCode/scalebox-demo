import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules'],
    testTimeout: 5 * 60 * 1000, // 5 minutes per test
    hookTimeout: 3 * 60 * 1000, // 3 minutes for hooks
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
      ],
    },
    // setupFiles: ['./vitest.setup.ts'],
  },
});
