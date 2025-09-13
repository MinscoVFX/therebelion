// scaffolds/fun-launch/src/server/dammv2-adapter.ts

import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// Import the Studio DAMM v2 runtime via package exports
import * as damm from '@meteora-invent/studio/lib/damm_v2';

export type DammV2PoolKeys = {
  programId: PublicKey;
  pool: PublicKey;
  lpMint: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  authorityPda: PublicKey;
};

function pickPoolResolver(mod: any): ((args: any) => Promise<any>) | null {
  return (
    mod?.getPoolByLpMint ||
    mod?.resolvePoolByLpMint ||
    mod?.poolFromLpMint ||
    (mod?.helpers && (mod.helpers.getPoolByLpMint || mod.helpers.resolvePoolByLpMint)) ||
    null
  );
}

function pickRemoveBuilder(mod: any): ((args: any) => Promise<any>) | null {
  return (
    mod?.buildRemoveLiquidityIx ||
    mod?.removeLiquidityIx ||
    (mod?.builders && (mod.builders.buildRemoveLiquidityIx || mod.builders.removeLiquidity)) ||
    null
  );
}

export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
  priorityMicros?: number;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;

  const removeBuilder = pickRemoveBuilder(damm);
  if (!removeBuilder) {
    throw new Error('Studio DAMM v2: remove-liquidity builder not found in package exports.');
  }

  // Ensure user has ATAs ready for token A & B
  const ixs: TransactionInstruction[] = [];

  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      getAssociatedTokenAddressSync(poolKeys.tokenAMint, owner, false),
      owner,
      poolKeys.tokenAMint
    )
  );
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      getAssociatedTokenAddressSync(poolKeys.tokenBMint, owner, false),
      owner,
      poolKeys.tokenBMint
    )
  );

  const userLpAta = getAssociatedTokenAddressSync(poolKeys.lpMint, owner, false);

  // Ask Studio to build the actual remove-liquidity instruction(s)
  const removeIxs: TransactionInstruction | TransactionInstruction[] = await removeBuilder({
    programId: poolKeys.programId,
    pool: poolKeys.pool,
    authorityPda: poolKeys.authorityPda,
    lpMint: poolKeys.lpMint,
    tokenAVault: poolKeys.tokenAVault,
    tokenBVault: poolKeys.tokenBVault,
    user: owner,
    userLpAccount: userLpAta,
    userAToken: getAssociatedTokenAddressSync(poolKeys.tokenAMint, owner, false),
    userBToken: getAssociatedTokenAddressSync(poolKeys.tokenBMint, owner, false),
    // LP amount: for "remove all" cases, most Studio builders accept full balance by reading ATA internally,
    // or you can pass a large bigint. If your builder *requires* an amount, wire the ATA balance here.
  });

  ixs.push(...(Array.isArray(removeIxs) ? removeIxs : [removeIxs]));
  return ixs;
}
