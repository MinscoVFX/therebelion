// ESM version for CI env propagation
import fs from 'fs';
import path from 'path';
/* eslint-disable no-undef */
const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
const file = path.resolve(cwd, '.env.ci');
if (typeof process === 'undefined' || !fs.existsSync(file)) return;
const out = fs
  .readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((l) => !l.startsWith('#'));
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, out.join('\n') + '\n');
}
