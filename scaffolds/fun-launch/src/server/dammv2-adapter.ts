import {
  Connection, PublicKey, TransactionInstruction, SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

/**
 * You already have DAMM v2 code in Studio (used during migration).
 * Import the concrete builders your repo exposes. If names differ, just
 * replace the 2 calls below accordingly.
 *
 * Expected capabilities:
 *  - Read pool keys (vault As/Bs, authority PDA, lpMint)
 *  - Build remove-liquidity IX(s) given an LP amount
 */
// Example: adjust these imports to match your Studio lib locations/exports.
import * as Damm from '../../../studio/src/lib/dammv2';              // pool layout helpers
import { buildRemoveLiquidityIx } from '../../../studio/src/lib/dammv2/remove'; // the builder used by your script

export type DammV2PoolKeys = {
  programId: PublicKey;        // DAMM v2 program id
  pool: PublicKey;             // pool account
  lpMint: PublicKey;           // LP mint
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  authorityPda: PublicKey;     // pool authority PDA (signer for vaults)
};

export async function getUserLpAmount(
  connection: Connection,
  owner: PublicKey,
  lpMint: PublicKey
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(lpMint, owner, false);
  const acc = await connection.getTokenAccountBalance(ata).catch(() => null);
  if (!acc || !acc.value) return 0n;
  // amount is a string in base units
  return BigInt(acc.value.amount ?? '0');
}

/**
 * Build all instructions to remove 100% of user's LP from DAMM v2.
 * Creates missing ATAs for token A/B idempotently, then calls DAMM remove.
 */
export async function buildDammV2RemoveAllLpIxs(args: {
  connection: Connection;
  owner: PublicKey;
  poolKeys: DammV2PoolKeys;
}): Promise<TransactionInstruction[]> {
  const { connection, owner, poolKeys } = args;

  // 1) Read user's LP balance
  const userLp = await getUserLpAmount(connection, owner, poolKeys.lpMint);
  if (userLp === 0n) return []; // nothing to remove

  // 2) Ensure user token A/B ATAs exist (for receiving underlying)
  const userAToken = getAssociatedTokenAddressSync(poolKeys.tokenAMint, owner, false);
  const userBToken = getAssociatedTokenAddressSync(poolKeys.tokenBMint, owner, false);

  const preIxs: TransactionInstruction[] = [];
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner, userAToken, owner, poolKeys.tokenAMint
    ),
  );
  preIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      owner, userBToken, owner, poolKeys.tokenBMint
    ),
  );

  // 3) Build the actual remove-liquidity instruction(s)
  // NOTE: replace `buildRemoveLiquidityIx` with the exact function from your lib.
  const removeIxs = await buildRemoveLiquidityIx({
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
    // remove 100%:
    lpAmount: userLp,
    // optional slippage or minOut params if your builder supports them:
    // minA: 0n,
    // minB: 0n,
  });

  return [...preIxs, ...Array.isArray(removeIxs) ? removeIxs : [removeIxs]];
}
