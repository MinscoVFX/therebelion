// scaffolds/fun-launch/src/server/dbc-adapter.ts

import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import * as dbc from '@meteora-invent/studio/lib/dbc';

export type DbcPoolKeys = {
  pool: PublicKey;
  feeVault: PublicKey;
};

function pickClaimBuilder(mod: any): ((args: any) => Promise<TransactionInstruction | TransactionInstruction[]>) | null {
  return (
    mod?.buildClaimTradingFeeIx ||
    mod?.claimTradingFeeIx ||
    (mod?.builders && (mod.builders.buildClaimTradingFeeIx || mod.builders.claimTradingFeeIx)) ||
    null
  );
}

export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey;
}): Promise<TransactionInstruction> {
  const { connection, poolKeys, feeClaimer } = args;

  const builder = pickClaimBuilder(dbc);
  if (!builder) {
    throw new Error('Studio DBC: claim-fee builder not found in package exports.');
  }

  const maybe = await builder({
    connection,
    pool: poolKeys.pool,
    feeVault: poolKeys.feeVault,
    claimer: feeClaimer,
  });

  if (Array.isArray(maybe)) {
    if (maybe.length !== 1) {
      throw new Error('Studio DBC claim-fee returned multiple instructions; expected a single ix.');
    }
    return maybe[0];
  }
  return maybe;
}
