/// <reference types="node" />
/**
 * Fast mode smoke test for /api/dbc-one-click-exit (no simulation, with optional compute unit limit).
 * Run with: pnpm --filter @meteora-invent/scaffold/fun-launch exec ts-node src/tests/dbcFastExitSmoke.ts
 * Required env vars:
 *   TEST_OWNER_PUBKEY=<owner>
 *   TEST_DBC_POOL_KEYS='{"pool":"...","feeVault":"..."}'
 * Uses Node 18+ global fetch; no polyfill required.
 */

const OWNER = process.env.TEST_OWNER_PUBKEY || '';

async function main() {
  const dbcPoolKeysEnv = process.env.TEST_DBC_POOL_KEYS; // JSON: { pool: string; feeVault: string }
  if (!OWNER || !dbcPoolKeysEnv) {
    console.log('Set TEST_OWNER_PUBKEY and TEST_DBC_POOL_KEYS env vars to run this fast mode smoke test.');
    return;
  }
  let dbcPoolKeys: { pool: string; feeVault: string };
  try { dbcPoolKeys = JSON.parse(dbcPoolKeysEnv); } catch { console.error('Invalid TEST_DBC_POOL_KEYS JSON'); return; }

  const body = {
    ownerPubkey: OWNER,
    dbcPoolKeys,
    priorityMicros: 250_000,
    // fast mode: no simulateOnly, directly request tx build
    slippageBps: 50,
    computeUnitLimit: 900_000,
  };

  const res = await fetch('http://localhost:3000/api/dbc-one-click-exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log('Status', res.status);
  console.log('Response keys', Object.keys(json));
  if (json.tx) console.log('Tx (base64) length', json.tx.length);
  if (json.error) console.error('Build error', json.error);
}

main().catch(e => { console.error(e); process.exit(1); });

export {}; // ensure this file is treated as a module
