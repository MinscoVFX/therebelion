import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import path from 'path';

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

/** ----- Robust runtime resolution for Studio compiled JS (monorepo + Vercel) ----- */
function resolveStudio(pathInDist: string): string | null {
  try {
    return require.resolve(`@meteora-invent/studio/dist/${pathInDist}`);
  } catch {
    try {
      return path.join(process.cwd(), `../../studio/dist/${pathInDist}`);
    } catch {
      return null;
    }
  }
}

async function importStudioModule(pathInDist: string): Promise<any | null> {
  const target = resolveStudio(pathInDist);
  if (!target) return null;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - dynamic path; keep Next from bundling
  const mod = await import(/* webpackIgnore: true */ target);
  return mod ?? null;
}

/** Locate the remove-liquidity builder across supported export names. */
async function pickDammRemoveBuilder(): Promise<
  (params: any) => Promise<TransactionInstruction | TransactionInstruction[]>
> {
  const mod = await importStudioModule('lib/damm_v2/index.js');
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
async function getUserLpAmount(conn: Connection, owner: PublicKey, lpMint: PublicKey): Promise<bigint> {
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
 * NOTE: This function does not add ATA creations for A/B token — callers can add those if needed.
 */
export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;

  const removeBuilder = await pickDammRemoveBuilder();

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
    lpAmount, // 100%
  });

  return Array.isArray(ixs) ? ixs : [ixs];
}
