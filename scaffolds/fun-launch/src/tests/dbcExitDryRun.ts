// Simple dry-run script to ensure the API exit builder compiles & returns a tx.
// This is NOT an integration test (no signing). Intended to be node-executed with ts-node/register.

import 'cross-fetch/polyfill';

async function main() {
  const ownerPubkey = process.env.TEST_OWNER || '11111111111111111111111111111111'; // replace in real test
  const pool = process.env.TEST_DBC_POOL || '11111111111111111111111111111111';
  const feeVault = process.env.TEST_DBC_FEE_VAULT || '11111111111111111111111111111111';

  const r = await fetch('http://localhost:3000/api/dbc-one-click-exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerPubkey, dbcPoolKeys: { pool, feeVault }, priorityMicros: 100000 }),
  });
  try {
    const j = await r.json();
    if (!r.ok) {
      console.error('API error', j);
      process.exit(1);
    }
    if (!j.tx) {
      console.error('No tx field in response', j);
      process.exit(1);
    }
    console.log('Dry run success. Blockhash:', j.blockhash, 'Tx length (base64):', j.tx.length);
  } catch (e) {
    console.error('Failed parsing response', e);
    process.exit(1);
  }
  // Negative test: invalid slippage
  const rBad = await fetch('http://localhost:3000/api/dbc-one-click-exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerPubkey, dbcPoolKeys: { pool, feeVault }, slippageBps: 0 }),
  });
  const badJson = await rBad.json().catch(() => ({}));
  if (rBad.ok) {
    console.error('Expected validation failure for slippageBps=0');
    process.exit(1);
  } else {
    console.log('Validation check passed (slippageBps):', badJson.error);
  }
}

main().catch((e) => {
  console.error('Unexpected error in dry run', e);
  process.exit(1);
});
