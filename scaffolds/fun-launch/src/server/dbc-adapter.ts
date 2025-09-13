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
 * We use a dynamic import and explicitly ignore TS type resolution for the Studio path.
 */
export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey; // the connected wallet (creator/partner)
}): Promise<TransactionInstruction> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - resolve at runtime only; types provided via ambient .d.ts or bypassed
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
