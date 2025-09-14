/**
 * Smoke test for /api/dbc-one-click-exit using simulateOnly=true.
 * Run with: pnpm --filter @meteora-invent/scaffold/fun-launch exec ts-node src/tests/dbcExitSmoke.ts
 */
import 'isomorphic-fetch';

const OWNER = process.env.TEST_OWNER_PUBKEY || ''; // set a known wallet with at least one DBC position for full test

async function main() {
  const dbcPoolKeysEnv = process.env.TEST_DBC_POOL_KEYS; // JSON: { pool: string; feeVault: string }
  if (!OWNER || !dbcPoolKeysEnv) {
    console.log('Set TEST_OWNER_PUBKEY and TEST_DBC_POOL_KEYS env vars to run this smoke test.');
    return;
  }
  let dbcPoolKeys: { pool: string; feeVault: string };
  try { dbcPoolKeys = JSON.parse(dbcPoolKeysEnv); } catch { console.error('Invalid TEST_DBC_POOL_KEYS JSON'); return; }

  const body = {
    ownerPubkey: OWNER,
    dbcPoolKeys,
    priorityMicros: 250_000,
    simulateOnly: true,
    slippageBps: 50,
  };

  const res = await fetch('http://localhost:3000/api/dbc-one-click-exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log('Status', res.status);
  console.log('Response keys', Object.keys(json));
  if (json.logs) console.log('Log lines', json.logs.length);
  if (json.err) console.error('Simulation error', json.err);
}

main().catch(e => { console.error(e); process.exit(1); });
