import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';

/**
 * Minimal types for a DBC pool (trading-fee claim only).
 */
export type DbcPoolKeys = {
  pool: PublicKey;      // DBC pool account
  feeVault: PublicKey;  // DBC fee vault account
};

/**
 * Safely import Studio's compiled JS at runtime (avoids bundling TS sources).
 * Returns null if not found (e.g., Studio not built yet).
 */
async function importStudioDbcRuntime(): Promise<any | null> {
  // Build the path at runtime so bundlers don't statically resolve it.
  const path = ['../../../../studio', 'dist', 'lib', 'dbc', 'index.js'].join('/');
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - runtime import only
    const mod = await import(/* webpackIgnore: true */ path);
    return mod ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the DBC "claim trading fee" instruction for the creator/partner.
 */
export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey; // the connected wallet (creator/partner)
}): Promise<TransactionInstruction> {
  const DbcLib = await importStudioDbcRuntime();

  if (!DbcLib || !('buildClaimTradingFeeIx' in DbcLib)) {
    throw new Error(
      '[dbc-adapter] Could not load Studio DBC runtime (studio/dist/lib/dbc/index.js). ' +
      'Make sure @meteora-invent/studio is built before building fun-launch.'
    );
  }

  const fn = (DbcLib as any).buildClaimTradingFeeIx as (p: {
    connection: Connection;
    pool: PublicKey;
    feeVault: PublicKey;
    feeClaimer: PublicKey;
  }) => Promise<TransactionInstruction>;

  return await fn({
    connection: args.connection,
    pool: args.poolKeys.pool,
    feeVault: args.poolKeys.feeVault,
    feeClaimer: args.feeClaimer,
  });
}
