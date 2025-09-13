import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

/**
 * DAMM v2 pool keys structure.
 */
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

/**
 * Read user LP balance.
 */
export async function getUserLpAmount(
  connection: Connection,
  owner: PublicKey,
  lpMint: PublicKey
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(lpMint, owner, false);
  try {
    const acc = await connection.getTokenAccountBalance(ata);
    if (!acc || !acc.value) return 0n;
    return BigInt(acc.value.amount ?? '0');
  } catch {
    return 0n;
  }
}

/**
 * Build instructions to remove 100% LP from DAMM v2.
 * This uses a dynamic import of your Studio builder and suppresses TS type resolution on that line.
 */
export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;

  // 1) Fetch user LP balance
  const userLp = await getUserLpAmount(connection, owner, poolKeys.lpMint);
  if (userLp === 0n) return [];

  // 2) Ensure ATAs exist for underlying token A/B
  const userAToken = getAssociatedTokenAddressSync(poolKeys.tokenAMint, owner, false);
  const userBToken = getAssociatedTokenAddressSync(poolKeys.tokenBMint, owner, false);

  const ixs: TransactionInstruction[] = [];
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      userAToken,
      owner,
      poolKeys.tokenAMint
    )
  );
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      userBToken,
      owner,
      poolKeys.tokenBMint
    )
  );

  // 3) Import your Studio builder dynamically
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - allow unresolved module at type-time; we only need it at runtime
  const damm = await import('../../../studio/src/lib/dammv2/remove');

  if (!('buildRemoveLiquidityIx' in damm)) {
    throw new Error(
      'Studio DAMM v2 lib is missing `buildRemoveLiquidityIx`. ' +
      'Adjust the import path or export it from studio/src/lib/dammv2/remove.'
    );
  }

  const fn = (damm as any).buildRemoveLiquidityIx as (p: {
    programId: PublicKey;
    pool: PublicKey;
    authorityPda: PublicKey;
    lpMint: PublicKey;
    tokenAVault: PublicKey;
    tokenBVault: PublicKey;
    user: PublicKey;
    userLpAccount: PublicKey;
    userAToken: PublicKey;
    userBToken: PublicKey;
    lpAmount: bigint;
  }) => Promise<TransactionInstruction | TransactionInstruction[]>;

  const removeIxs = await fn({
    programId: poolKeys.programId,
    pool: poolKeys.pool,
    authorityPda: poolKeys.authorityPda,
    lpMint: poolKeys.lpMint,
    tokenAVault: poolKeys.tokenAVault,
    tokenBVault: poolKeys.tokenBVault,
    user: owner,
    userLpAccount: getAssociatedTokenAddressSync(poolKeys.lpMint, owner, false),
    userAToken,
    userBToken,
    lpAmount: userLp, // remove ALL LP
  });

  return [...ixs, ...(Array.isArray(removeIxs) ? removeIxs : [removeIxs])];
}
