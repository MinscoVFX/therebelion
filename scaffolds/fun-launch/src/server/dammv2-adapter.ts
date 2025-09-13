import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import path from 'path';
import fs from 'fs';

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

function resolveStudioDist(subpath: string): string | null {
  try {
    const pkg = require.resolve('@meteora-invent/studio/package.json');
    const base = path.dirname(pkg);
    const candidate = path.join(base, 'dist', subpath);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
async function importStudioModule(subpath: string): Promise<any | null> {
  const target = resolveStudioDist(subpath);
  if (!target) return null;
  // @ts-ignore
  const mod = await import(/* webpackIgnore: true */ target);
  return mod ?? null;
}

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

export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;
  const removeBuilder = await pickDammRemoveBuilder();

  const userLpAta = getAssociatedTokenAddressSync(poolKeys.lpMint, owner, false);
  const lpAmount = await getUserLpAmount(connection, owner, poolKeys.lpMint);
  if (lpAmount === 0n) throw new Error('No LP tokens found for this DAMM v2 pool.');

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
    lpAmount,
  });

  return Array.isArray(ixs) ? ixs : [ixs];
}
