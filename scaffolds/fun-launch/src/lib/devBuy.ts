// scaffolds/fun-launch/src/lib/devBuy.ts

export type DevBuyParams = {
  /** DBC *virtual pool* address (NOT the mint, NOT the config key) */
  poolAddress: string;
  /** Amount of SOL to spend (e.g., 0.1) */
  amountInSol: number;
  /** Slippage in basis points, default 100 (1%) */
  slippageBps?: number;
  /** Optional priority fee in micro-lamports (e.g., 100_000) */
  priorityMicroLamports?: number;
  /** Optional referral token account (SPL token account pubkey) */
  referralTokenAccount?: string;
};

export type DevBuyResponse =
  | {
      ok: true;
      signature: string;
      explorer: string;
      spentLamports: string;
      minOut: string;
      priceBefore: string;
      priceAfter: string;
      lastValidBlockHeight: number;
    }
  | {
      ok: false;
      error: string;
      [k: string]: unknown;
    };

/**
 * Call the /api/dev-buy endpoint.
 * This helper is intentionally minimal and UI-framework agnostic.
 */
export async function devBuy(params: DevBuyParams): Promise<DevBuyResponse> {
  // Lightweight client-side validation to avoid common mistakes
  if (!params?.poolAddress || typeof params.poolAddress !== "string") {
    return { ok: false, error: "poolAddress is required" } as DevBuyResponse;
  }
  if (!Number.isFinite(params.amountInSol) || params.amountInSol <= 0) {
    return { ok: false, error: "amountInSol must be > 0" } as DevBuyResponse;
  }

  const res = await fetch("/api/dev-buy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });

  let data: DevBuyResponse;
  try {
    data = (await res.json()) as DevBuyResponse;
  } catch (e) {
    return {
      ok: false,
      error: `Unexpected response from server (status ${res.status})`,
    } as DevBuyResponse;
  }
  return data;
}
