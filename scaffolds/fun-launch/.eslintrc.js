/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['plugin:@next/next/core-web-vitals'],
  overrides: [
    // Vendor typings / TradingView bundle: noisy types we don't control
    {
      files: ['src/components/AdvancedTradingView/**', '**/*.d.ts'],
      rules: {
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    // UI source: relax unused var rules (still flag real issues)
    {
      files: ['src/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      },
    },
  ],
};
