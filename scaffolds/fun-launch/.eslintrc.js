/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  // Rely on extends to pull in most plugins; only declare Next.js explicitly to avoid duplicate resolution
  plugins: ['@next/next'],
  extends: [
    'eslint:recommended',
  'plugin:@typescript-eslint/recommended',
  'plugin:react/recommended',
  'plugin:react-hooks/recommended',
  'plugin:import/recommended',
    'plugin:@next/next/core-web-vitals',
  ],
  settings: {
    react: { version: 'detect' },
    'import/resolver': {
      typescript: {},
    },
  },
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    '.next/**',
    'src/components/AdvancedTradingView/**',
    '**/*.d.ts',
  ],
  rules: {
    // keep web-vitals useful, but calm TypeScript noise in UI
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    'react/react-in-jsx-scope': 'off',
    // Disable prop-types since we use TypeScript
    'react/prop-types': 'off',
  },
};
