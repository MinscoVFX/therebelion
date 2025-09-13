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
 * Meteora DAMM v2 pool keys.
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
 * Read user's LP balance (base units).
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
 * Build instructions to remove 100% of user's LP from DAMM v2.
 * If your Studio lib doesn't (yet) export a remove-liquidity builder,
 * we skip gracefully so the DBC fee-claim flow still works.
 */
export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;

  // 1) Check user's LP balance
  const userLp = await getUserLpAmount(connection, owner, poolKeys.lpMint);
  if (userLp === 0n) return []; // nothing to remove

  // 2) Ensure user ATAs exist for receiving token A/B
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

  // 3) Import Studio DAMM v2 module at runtime (correct relative path from this file)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - resolve at runtime; ambient types silence TS resolution
  const dammModule = await import('../../../../studio/src/lib/damm_v2');

  // Cast to any to avoid TS2339 on property probing
  const damm: any = dammModule as any;

  // Try common export names (adjust later if you add a specific builder)
  const builder: any =
    damm.buildRemoveLiquidityIx ||
    damm.removeLiquidityIx ||
    (damm.builders && (damm.builders.removeLiquidity || damm.builders.buildRemoveLiquidityIx)) ||
    null;

  if (!builder) {
    // No exported remove-liquidity builder yet; skip gracefully.
    console.warn(
      '[dammv2-adapter] No remove-liquidity builder exported in studio/src/lib/damm_v2. ' +
      'Skipping LP removal and proceeding with fee-claim-only.'
    );
    return ixs;
  }

  // 4) Build remove-liquidity instruction(s) for 100% LP burn
  const removeIxs: TransactionInstruction | TransactionInstruction[] = await builder({
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
    // Add min out / slippage fields here if your builder supports them:
    // minA: 0n,
    // minB: 0n,
  });

  return [...ixs, ...(Array.isArray(removeIxs) ? removeIxs : [removeIxs])];
}
