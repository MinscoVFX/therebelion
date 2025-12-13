// scaffolds/fun-launch/src/types/launch.ts

export type LaunchProvider = 'meteora' | 'raydium';
export type MigrateType = 'amm' | 'cpmm';

export interface LaunchFormValues {
  // Which launch stack to use
  provider: LaunchProvider;

  // Token metadata
  name: string;
  symbol: string;
  decimals: number;
  imageUrl?: string;
  description?: string;

  // Curve params (use strings in the form to avoid float issues)
  supplyTokens: string; // token A to sell on curve, as integer string
  raiseTargetLamports: string; // SOL target in lamports, as integer string
  migrateType: MigrateType;

  // Vanity (optional). If present, we’ll use init-with-existing-mint.
  vanityMint?: string; // base58 mint address
}
