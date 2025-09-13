import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';

/**
 * NOTE: We reuse your Studio code instead of re-implementing program layouts.
 * If this relative import bothers Next.js, copy the used functions into this file.
 *
 * The Studio repo already exposes DBC helpers & a “claim_trading_fee” script.  👇
 *   studio/src/lib/dbc/index.ts
 *   studio/src/scripts/dbc/claim_trading_fee.ts
 */
import * as DbcLib from '../../../studio/src/lib/dbc'; // adjust if your path differs

export type DbcPoolKeys = {
  pool: PublicKey;
  feeVault: PublicKey;
  // add others if your lib exposes them (token vaults, authority PDA, etc.)
};

export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey;   // your creator/partner wallet (must match on-chain config)
}): Promise<TransactionInstruction> {
  // Your Studio lib already has the builder used by the script “dbc-claim-trading-fee”.
  // Exported name may be `buildClaimTradingFeeIx` (or similar) in your lib.
  // If it differs, import the right symbol from studio/src/lib/dbc/index.ts.
  // @ts-expect-error depends on your lib’s exact export name
  return await DbcLib.buildClaimTradingFeeIx({
    connection: args.connection,
    pool: args.poolKeys.pool,
    feeVault: args.poolKeys.feeVault,
    feeClaimer: args.feeClaimer,
  });
}
