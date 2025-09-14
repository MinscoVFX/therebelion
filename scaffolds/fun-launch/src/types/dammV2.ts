import { PublicKey, TransactionInstruction } from '@solana/web3.js';

// Narrow (best-effort) typed interface for DAMM v2 remove-liquidity builder arguments.
// Runtime builder may accept additional fields; keep them optional via index signature.
export interface DammV2RemoveLiquidityArgs {
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
  lpAmount?: bigint; // Mutually exclusive with percent & liquidityDelta (builder usually wants one)
  percent?: number; // 0-100
  liquidityDelta?: bigint; // Raw delta (advanced)
  positionPubkey?: PublicKey; // Some variants reference a position account
  slippageBps?: number; // 1-10_000
  [extra: string]: unknown; // allow forward compatibility
}

export type DammV2RemoveLiquidityBuilder = (
  args: DammV2RemoveLiquidityArgs
) => Promise<TransactionInstruction | TransactionInstruction[]>;

export function assertOneLiquiditySpecifier(args: DammV2RemoveLiquidityArgs) {
  const provided = [
    args.lpAmount !== undefined,
    args.percent !== undefined,
    args.liquidityDelta !== undefined,
  ].filter(Boolean).length;
  if (provided === 0) {
    throw new Error('One of lpAmount | percent | liquidityDelta must be provided');
  }
  if (provided > 1) {
    throw new Error('Provide only one of lpAmount | percent | liquidityDelta');
  }
}
