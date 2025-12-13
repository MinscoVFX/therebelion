// scaffolds/fun-launch/src/types/launch.ts

export type LaunchProvider = 'meteora' | 'raydium';
export type MigrateType = 'amm' | 'cpmm';
export type QuoteAsset = 'SOL' | 'USDC';

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

  // -------------------------
  // NEW (optional): Atomic launch + pre-buy
  // -------------------------

  /**
   * If true, build a single atomic VersionedTransaction for:
   * createPool + (optional) creator buy.
   * Default is false to preserve existing flow.
   */
  atomic?: boolean;

  /**
   * Optional "creator buy" (pre-buy) amount IN quote units.
   * - If quoteAsset = SOL: lamports (1 SOL = 1_000_000_000)
   * - If quoteAsset = USDC: base units (6 decimals)
   *
   * When unset or "0", no buy is included.
   */
  preBuyAmountIn?: string;

  /**
   * Optional minimum amount out (base token units) for the pre-buy swap.
   * Use "0" for no protection (not recommended in production).
   */
  preBuyMinOut?: string;

  /**
   * Quote asset used for pre-buy and/or raise target interpretation.
   * Your current flow likely assumes SOL; default remains SOL if omitted.
   */
  quoteAsset?: QuoteAsset;

  /**
   * Optional overrides for priority fees (same shape as your API expects).
   * If omitted, server uses /api/fees/recommend just like today.
   */
  cuLimit?: number;
  microLamports?: number;
}
