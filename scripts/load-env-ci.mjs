#!/usr/bin/env node
// Lightweight .env.ci loader ensuring values are injected before running subsequent scripts.
// Avoids adding dotenv dependency in runtime path; CI calls: `node scripts/load-env-ci.mjs <cmd> [args...]`.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), '.env.ci');
let content = '';
try {
  content = readFileSync(envFile, 'utf8');
} catch (e) {
  console.error('[env-loader] Missing .env.ci file.');
  process.exit(1);
}

for (const line of content.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const rawVal = trimmed.slice(eq + 1).trim();
  // Strip surrounding quotes if present
  const val = rawVal.replace(/^['"]|['"]$/g, '');
  if (!(key in process.env)) {
    process.env[key] = val;
  }
}

const [, , cmd, ...args] = process.argv;
if (!cmd) {
  console.error('[env-loader] No command provided to execute after loading env.');
  process.exit(1);
}

const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[env-loader] Process terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
