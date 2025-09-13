import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

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

async function importStudioDammRuntime(): Promise<any | null> {
  const path = ['../../../../studio', 'dist', 'lib', 'damm_v2', 'index.js'].join('/');
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const mod = await import(/* webpackIgnore: true */ path);
    return mod ?? null;
  } catch {
    return null;
  }
}

export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;

  const userLp = await getUserLpAmount(connection, owner, poolKeys.lpMint);
  if (userLp === 0n) return [];

  const userAToken = getAssociatedTokenAddressSync(poolKeys.tokenAMint, owner, false);
  const userBToken = getAssociatedTokenAddressSync(poolKeys.tokenBMint, owner, false);

  const ixs: TransactionInstruction[] = [];
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner, userAToken, owner, poolKeys.tokenAMint
    )
  );
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner, userBToken, owner, poolKeys.tokenBMint
    )
  );

  const damm = await importStudioDammRuntime();

  const builder: any =
    damm &&
    (damm.buildRemoveLiquidityIx ||
      damm.removeLiquidityIx ||
      (damm.builders && (damm.builders.removeLiquidity || damm.builders.buildRemoveLiquidityIx))) ||
    null;

  if (!builder) {
    console.warn(
      '[dammv2-adapter] No remove-liquidity builder exported in studio/dist/lib/damm_v2. ' +
      'Skipping LP removal and proceeding with fee-claim-only.'
    );
    return ixs;
  }

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
    lpAmount: userLp,
  });

  return [...ixs, ...(Array.isArray(removeIxs) ? removeIxs : [removeIxs])];
}
