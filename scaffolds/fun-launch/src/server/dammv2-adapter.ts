// scaffolds/fun-launch/src/server/dammv2-adapter.ts
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
import path from 'path';
import { getDammV2Runtime } from './studioRuntime';

/** DAMM v2 pool keys we care about */
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

async function importDammRuntime(): Promise<any> {
  const mod = await getDammV2Runtime();
  if (mod) return mod;
  const legacy = [
    '@meteora-invent/studio/dist/lib/damm_v2/index.js',
    path.join(process.cwd(), '../../studio/dist/lib/damm_v2/index.js'),
    path.join(process.cwd(), '../../studio/src/lib/damm_v2/index.ts'),
  ];
  for (const c of legacy) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const resolved = require.resolve(c);
      return await import(/* webpackIgnore: true */ resolved);
    } catch {
      /* continue */
    }
  }
  throw new Error('Studio DAMM v2 module not found (build @meteora-invent/studio).');
}

function pickRemoveBuilder(
  mod: any
):
  | ((args: Record<string, unknown>) => Promise<TransactionInstruction | TransactionInstruction[]>)
  | null {
  return (
    mod?.buildRemoveLiquidityIx ||
    mod?.removeLiquidityIx ||
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

/**
 * Build all instructions to remove **ALL** lp for the provided DAMM v2 pool.
 * Also ensures ATAs for token A/B exist.
 */
export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
  priorityMicros?: number;
  /** Optional injected runtime module (test seam) */
  runtimeModule?: any;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys, priorityMicros = 250_000, runtimeModule } = args;

  const damm = runtimeModule || (await importDammRuntime());
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
    tokenAVault: poolKeys.tokenAVault,
    tokenBVault: poolKeys.tokenBVault,
    user: owner,
    userLpAccount,
    userAToken,
    userBToken,
    lpAmount,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  if (!removeIxs) throw new Error('Remove LP builder returned no instructions.');
  ixs.push(...(Array.isArray(removeIxs) ? removeIxs : [removeIxs]));

  return ixs;
}
