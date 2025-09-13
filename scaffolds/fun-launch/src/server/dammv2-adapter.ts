import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

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

const requireNode = createRequire(import.meta.url);

/** Resolve a file inside @meteora-invent/studio/dist reliably in serverless. */
function resolveStudioDist(subpath: string): string | null {
  try {
    const pkg = requireNode.resolve('@meteora-invent/studio/package.json');
    const base = path.dirname(pkg);
    const candidate = path.join(base, 'dist', subpath);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
function requireStudioModule(subpath: string): any | null {
  const target = resolveStudioDist(subpath);
  if (!target) return null;
  return requireNode(target);
}

/** Locate the remove-liquidity builder across supported export names. */
function getDammRemoveBuilder(): (
  params: any
) => Promise<TransactionInstruction | TransactionInstruction[]> {
  const mod = requireStudioModule('lib/damm_v2/index.js');
  if (!mod) throw new Error('DAMM v2 runtime not found (studio dist missing).');

  const removeBuilder =
    mod.buildRemoveLiquidityIx ||
    mod.removeLiquidityIx ||
    (mod.builders && (mod.builders.buildRemoveLiquidityIx || mod.builders.removeLiquidity)) ||
    null;

  if (!removeBuilder) throw new Error('Remove-liquidity builder missing in DAMM v2 runtime.');
  return removeBuilder;
}

/** Read base-units LP balance from owner’s ATA (0n if missing). */
async function getUserLpAmount(
  conn: Connection,
  owner: PublicKey,
  lpMint: PublicKey
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(lpMint, owner, false);
  try {
    const bal = await conn.getTokenAccountBalance(ata);
    if (!bal?.value) return 0n;
    return BigInt(bal.value.amount ?? '0');
  } catch {
    return 0n;
  }
}

/**
 * Build the full set of instructions to remove **100%** LP for the provided DAMM v2 pool.
 */
export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;

  const removeBuilder = getDammRemoveBuilder();

  // Determine 100% LP amount from user's LP ATA
  const userLpAta = getAssociatedTokenAddressSync(poolKeys.lpMint, owner, false);
  const lpAmount = await getUserLpAmount(connection, owner, poolKeys.lpMint);
  if (lpAmount === 0n) {
    throw new Error('No LP tokens found for this DAMM v2 pool.');
  }

  const ixs = await removeBuilder({
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
    lpAmount, // remove 100%
  });

  return Array.isArray(ixs) ? ixs : [ixs];
}
