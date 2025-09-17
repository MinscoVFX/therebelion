#!/usr/bin/env node
// Simple retry wrapper for the build to handle intermittent Next.js worker SIGTERM exits.
import { spawn } from 'node:child_process';

const MAX_RETRIES = Number(process.env.BUILD_MAX_RETRIES || 2);
const DELAY_MS = Number(process.env.BUILD_RETRY_DELAY_MS || 2000);

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn('node', ['scripts/load-env-ci.mjs', 'pnpm', 'build'], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { code, signal } = await runOnce();
    if (code === 0) {
      process.exit(0);
    }
    const sig = signal || '';
    const isLast = attempt === MAX_RETRIES;
    console.error(
      `Build attempt ${attempt} failed (code=${code}${sig ? `, signal=${sig}` : ''})${
        isLast ? '' : ` — retrying in ${DELAY_MS}ms`
      }`
    );
    if (isLast) break;
    await sleep(DELAY_MS);
  }
  process.exit(1);
})();
