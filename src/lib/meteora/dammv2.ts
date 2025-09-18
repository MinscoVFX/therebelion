// DAMM v2 helpers (stubs only)

import { Connection, PublicKey } from '@solana/web3.js';
import { buildDammV2RemoveAllLpIxs, DammV2PoolKeys } from '../../server/dammv2-adapter';

// Fetches DAMM v2 state for a wallet (stub: implement backend call or SDK logic)
export async function getDammState() {
  // TODO: Implement actual state fetch (positions, balances, etc)
  // Example: call backend or SDK
  return {};
}

// Claims DAMM v2 fees for a wallet (stub: implement backend call or SDK logic)
export async function claimDammFees() {
  // TODO: Implement actual fee claim logic
  // Example: call backend or SDK
  return true;
}

// Gets the latest DAMM v2 position for a wallet (stub: implement backend call or SDK logic)
export async function getLatestPosition() {
  // TODO: Implement actual position fetch
  // Example: call backend or SDK
  return null;
}

// Builds instructions to withdraw all DAMM v2 liquidity for a wallet
export async function buildWithdrawAllIx(
  connection: Connection,
  owner: PublicKey,
  poolKeys: DammV2PoolKeys,
  priorityMicros?: number
) {
  return await buildDammV2RemoveAllLpIxs({
    connection,
    owner,
    poolKeys,
    priorityMicros,
  });
}
