/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:import/recommended',
  ],
  settings: { react: { version: 'detect' } },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
  },
};
