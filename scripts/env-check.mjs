#!/usr/bin/env node
import { execSync } from 'node:child_process';

function log(level, msg) {
  console[level](`[env-check] ${msg}`);
}

const errors = [];
const warnings = [];

// Accept any of these RPC variable names; require at least one.
const rpcCandidates = ['RPC_ENDPOINT', 'RPC_URL', 'NEXT_PUBLIC_RPC_URL'];
const presentRpc = rpcCandidates.find((k) => process.env[k]);
if (!presentRpc) {
  errors.push(`Missing RPC endpoint (set one of: ${rpcCandidates.join(', ')})`);
} else {
  // eslint-disable-next-line no-console
  console.log(`[env-check] Using RPC from ${presentRpc}`);
}

const placeholder =
  (process.env.DBC_CLAIM_FEE_DISCRIMINATOR || '0102030405060708') === '0102030405060708';
if (
  placeholder &&
  process.env.NODE_ENV === 'production' &&
  process.env.ALLOW_PLACEHOLDER_DBC !== 'true'
) {
  errors.push('Placeholder DBC_CLAIM_FEE_DISCRIMINATOR in production');
} else if (placeholder) {
  warnings.push('Using placeholder DBC_CLAIM_FEE_DISCRIMINATOR (acceptable only for dev/testing)');
}

if (process.env.ALLOWED_DBC_PROGRAM_IDS) {
  const base58Re = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // Solana base58 (no 0,O,I,l) typical 32–44 length
  const entries = process.env.ALLOWED_DBC_PROGRAM_IDS.split(',')
    .map((s) => s.trim().replace(/^\[|\]$/g, ''))
    .filter(Boolean);
  for (const id of entries) {
    if (!base58Re.test(id)) warnings.push(`Suspicious program id format: "${id}"`);
  }
}

let commit = null;
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim();
} catch {}

for (const w of warnings) log('warn', w);
for (const e of errors) log('error', e);

if (errors.length) {
  log(
    'error',
    `FAILED (${errors.length} errors, ${warnings.length} warnings) commit=${commit || 'n/a'}`
  );
  process.exit(1);
} else {
  log('log', `OK (${warnings.length} warnings) commit=${commit || 'n/a'}`);
}
