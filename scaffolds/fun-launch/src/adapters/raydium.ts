// scaffolds/fun-launch/src/adapters/raydium.ts
// Safe stub: builds shapes and helpers without importing Raydium SDK yet.
// We'll swap internals to real Raydium calls after wiring env + route.

import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

export type MigrateType = 'amm' | 'cpmm';

export interface RaydiumCreateArgs {
  // creator wallet (payer & signer — supplied by client)
  creator: PublicKey;

  // platform config
  platformPda: PublicKey;              // env RAYDIUM_PLATFORM_PDA
  shareFeeBps: number;                 // env RAYDIUM_SHARE_FEE_BPS
  creationFeeLamports: bigint;         // env RAYDIUM_CREATION_FEE_LAMPORTS
  creationFeeReceiver: PublicKey;      // platform treasury / authority pubkey

  // token metadata
  name: string;
  symbol: string;
  decimals: number;
  imageUrl?: string;
  description?: string;

  // curve params
  supplyTokens: bigint;                // total token A to sell on curve
  raiseTargetLamports: bigint;         // SOL (lamports) to raise
  migrateType: MigrateType;            // 'amm' | 'cpmm'

  // vanity (optional): bring-your-own mint
  existingMint?: PublicKey;
}

/** Build a simple SystemProgram transfer for your one-time creation fee. */
export function buildCreationFeeIx(
  from: PublicKey,
  to: PublicKey,
  lamports: bigint,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: to,
    lamports: Number(lamports),
  });
}

/**
 * Stub: returns a Transaction with ONLY the creation-fee ix.
 * We'll append real LaunchLab initialization ixs once we wire the SDK.
 */
export async function buildCreateLaunchpadTx(args: RaydiumCreateArgs): Promise<Transaction> {
  const tx = new Transaction();
  tx.add(buildCreationFeeIx(args.creator, args.creationFeeReceiver, args.creationFeeLamports));

  // Placeholder until we wire Raydium SDK:
  // In the next step, we will replace this throw with actual LaunchLab ixs
  // (either create-mint+init or init-with-existing-mint for vanity).
  // Keeping a clear message to avoid silent partial behavior.
  // eslint-disable-next-line no-throw-literal
  throw {
    code: 'RAYDIUM_NOT_WIRED',
    message:
      'Raydium LaunchLab instructions not wired yet. Adapter is ready; route will guard and return 501.',
  };
}

/**
 * Stub for platform-fee claim. We’ll fill with real ixs.
 */
export async function buildClaimPlatformFeeTx(
  _platformPda: PublicKey,
  _recipient: PublicKey,
): Promise<Transaction> {
  // Placeholder to be implemented with Raydium SDK
  // eslint-disable-next-line no-throw-literal
  throw {
    code: 'RAYDIUM_NOT_WIRED',
    message: 'Claim platform fee not wired yet.',
  };
}
