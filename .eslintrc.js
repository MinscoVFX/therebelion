/**
 * Try to load the shared workspace config by package name first.
 * When running in CI or unusual resolution contexts, fall back to a relative path.
 */
const path = require('path');

let baseConfig;
try {
  baseConfig = require.resolve('@meteora-invent/config-eslint');
} catch {
  baseConfig = path.join(__dirname, 'packages', 'config', 'eslint');
}

module.exports = {
  root: true,
  extends: [baseConfig],
};
