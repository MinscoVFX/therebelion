import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test.setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'json-summary'],
      // Focus coverage on core logic & server hooks; exclude large UI / generated / config surface
      include: [
        'scaffolds/fun-launch/src/server/**/*.ts',
        'scaffolds/fun-launch/src/hooks/**/*.ts',
        'scaffolds/fun-launch/src/app/api/**/*.ts',
        'src/**/*.ts',
      ],
      exclude: [
        'dist/**',
        '**/node_modules/**',
        '**/scripts/**',
        '**/*.d.ts',
        '**/vitest.config.*',
        '**/tsconfig.*',
        'scaffolds/fun-launch/src/components/**',
        'scaffolds/fun-launch/src/icons/**',
        'scaffolds/fun-launch/src/pages/**',
        'scaffolds/fun-launch/.next/**',
        'studio/**',
        'packages/**',
      ],
      thresholds: {
        // Raised after adding API + service tests (current ~25% lines, >50% funcs/branches). Non-regression guard.
        lines: 20,
        statements: 20,
        branches: 12,
        functions: 35,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
