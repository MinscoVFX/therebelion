import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'json-summary'],
      exclude: [
        'dist/**',
        '**/node_modules/**',
        '**/scripts/**',
        '**/*.d.ts',
        '**/vitest.config.*',
        '**/tsconfig.*',
      ],
      thresholds: {
        lines: 60,
        statements: 60,
        branches: 45,
        functions: 55,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
