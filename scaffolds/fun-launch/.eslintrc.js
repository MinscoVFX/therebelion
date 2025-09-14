/** Local overrides for the scaffold */
module.exports = {
  root: false,
  ignorePatterns: ['src/components/AdvancedTradingView/charting_library.d.ts', 'src/**/*.d.ts'],
  overrides: [
    {
      files: ['**/*.d.ts'],
      rules: {
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
      },
    },
    {
      files: ['src/**/*.{ts,tsx}'],
      rules: {
        // Keep unused-vars as warnings so CI doesn't fail when something is temporarily unused
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
  ],
};
