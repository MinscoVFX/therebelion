// DAMM v2 helpers (stubs only)
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
  connection: any;
  owner: any;
  poolKeys: any;
  priorityMicros?: number;
}) {
  try {
    const { buildDammV2RemoveAllLpIxs } = require('../../server/dammv2-adapter');
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
