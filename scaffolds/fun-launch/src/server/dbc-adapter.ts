import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';

/**
 * Minimal types for a DBC pool (trading-fee claim only).
 */
export type DbcPoolKeys = {
  pool: PublicKey;      // DBC pool account
  feeVault: PublicKey;  // DBC fee vault account
};

/**
 * Build the DBC "claim trading fee" instruction for the creator/partner.
 *
 * This wraps your Studio DBC lib so the Next.js app doesn’t need
 * to re-implement program layouts here.
 *
 * If your Studio export path/name differs, adjust the import below.
 */
export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey; // the connected wallet (creator/partner)
}): Promise<TransactionInstruction> {
  // Lazy import so this only loads on the server (API route),
  // and avoids pulling the whole Studio tree into client bundles.
  const DbcLib = await import('../../../studio/src/lib/dbc');

  if (!('buildClaimTradingFeeIx' in DbcLib)) {
    throw new Error(
      'Studio DBC lib is missing `buildClaimTradingFeeIx`. ' +
      'Adjust the import path or export the builder from studio/src/lib/dbc.'
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
