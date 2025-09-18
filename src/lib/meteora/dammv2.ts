// DAMM v2 helpers (stubs only)
import { buildDammV2RemoveAllLpIxs } from '../../server/dammv2-adapter';
import type { Connection, PublicKey } from '@solana/web3.js';
import type { PoolKeys } from './universalExit';
export function getDammState() {
  return null;
}
export function claimDammFees() {
  return null;
}
export function getLatestPosition() {
  return null;
}
export function buildWithdrawAllIx(params: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: PoolKeys;
  priorityMicros?: number;
}) {
  try {
    return buildDammV2RemoveAllLpIxs({
      connection: params.connection,
      owner: params.owner,
      poolKeys: params.poolKeys,
      priorityMicros: params.priorityMicros || 250_000,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('buildWithdrawAllIx error:', err);
    return [];
  }
}
