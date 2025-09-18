import {
  Connection,
  PublicKey,
  TransactionInstruction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getDammV2Runtime } from './studioRuntime.js';

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

function pickRemoveBuilder(
  mod: any
):
  | ((args: Record<string, unknown>) => Promise<TransactionInstruction | TransactionInstruction[]>)
  | null {
  return (
    mod?.buildRemoveLiquidityIx ||
    mod?.removeLiquidityIx ||
    mod?.actions?.removeLiquidity ||
    (mod?.builders && (mod.builders.buildRemoveLiquidityIx || mod.builders.removeLiquidity)) ||
    null
  );
}

async function getUserLpAmount(
  conn: Connection,
  owner: PublicKey,
  lpMint: PublicKey
): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(lpMint, owner, false);
    const info = await conn.getTokenAccountBalance(ata);
    const raw = info?.value?.amount ?? '0';
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
  priorityMicros?: number;
  runtimeModule?: any;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys, priorityMicros = 250_000, runtimeModule } = args;
  const damm = runtimeModule || (await getDammV2Runtime());
  const removeBuilder = pickRemoveBuilder(damm);
  if (!removeBuilder)
    throw new Error('DAMM v2 remove-liquidity function not found in studio runtime.');
  const ixs: TransactionInstruction[] = [];
  if (priorityMicros && priorityMicros > 0) {
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(priorityMicros) }));
  }
  const userAToken = getAssociatedTokenAddressSync(poolKeys.tokenAMint, owner, false);
  const userBToken = getAssociatedTokenAddressSync(poolKeys.tokenBMint, owner, false);
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(owner, userAToken, owner, poolKeys.tokenAMint)
  );
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(owner, userBToken, owner, poolKeys.tokenBMint)
  );
  const lpAmount = await getUserLpAmount(connection, owner, poolKeys.lpMint);
  if (lpAmount <= 0n) {
    throw new Error('No LP tokens found for this pool in the wallet.');
  }
  const userLpAccount = getAssociatedTokenAddressSync(poolKeys.lpMint, owner, false);
  const removeIxs = await removeBuilder({
    programId: poolKeys.programId,
    pool: poolKeys.pool,
    authorityPda: poolKeys.authorityPda,
    lpMint: poolKeys.lpMint,
    tokenAMint: poolKeys.tokenAMint,
    tokenBMint: poolKeys.tokenBMint,
    tokenAVault: poolKeys.tokenAVault,
    tokenBVault: poolKeys.tokenBVault,
    user: owner,
    userLpAccount,
    userAToken,
    userBToken,
    lpAmount,
    tokenProgram: TOKEN_PROGRAM_ID,
    slippageBps: 50,
    connection,
  });
  if (!removeIxs) throw new Error('Remove LP builder returned no instructions.');
  ixs.push(...(Array.isArray(removeIxs) ? removeIxs : [removeIxs]));
  return ixs;
}
