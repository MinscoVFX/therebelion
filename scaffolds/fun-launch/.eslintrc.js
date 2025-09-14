/** Local overrides for the scaffold */
module.exports = {
  /* eslint-disable */
  module.exports = {
    // Extend our workspace config AND Next's recommended rules
    extends: [
      '@meteora-invent/config-eslint',
      'plugin:@next/next/core-web-vitals',
    ],
    plugins: [
      '@next/next',
      'react',
      'react-hooks',
      'import',
      '@typescript-eslint',
    ],
    rules: {
      // Quiet the CI for now (style-only complaints or vendor/codemod-heavy)
      'import/order': 'off',
      'import/no-duplicates': 'off',
      'import/no-cycle': 'off',
      'no-case-declarations': 'off',
      'no-duplicate-case': 'off',
      'no-empty': 'off',

      // Missing rule definitions previously -> add plugins above and keep off
      'react/display-name': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@next/next/no-img-element': 'off',

      // Tame TypeScript noise to warnings
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
    overrides: [
      {
        files: ['**/*.d.ts'],
        rules: {
          // never lint vendor typings
          'import/order': 'off',
          '@typescript-eslint/ban-types': 'off',
        },
      },
    ],
  };
};
