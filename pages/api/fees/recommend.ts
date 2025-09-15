import type { NextApiRequest, NextApiResponse } from "next";
import { Connection } from "@solana/web3.js";
import { getEnv } from "../../../src/env/required";

/**
 * Recommends microLamports per CU using recent block priorities.
 * Strategy:
 * - Read recent prioritization fees and pick p80.
 * - Clamp to a sane min/max window to avoid outrageous spikes.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const env = getEnv();
    const connection = new Connection(env.RPC_URL, "confirmed");

    // recentPrioritizationFees is available on many RPCs (Jito/RPCPool/Helius/Ankr etc.),
    // but we’ll gracefully fall back to static defaults if missing.
    let fees: any[] = [];
    try {
      // Some providers expose getRecentPrioritizationFees; others use getRecentPrioritizationFees({limit})
      // We attempt both patterns.
      // @ts-ignore
      fees = (await (connection as any).getRecentPrioritizationFees?.({})) ??
             // @ts-ignore
             (await (connection as any).getRecentPrioritizationFees?.()) ?? [];
    } catch {}

    const values = Array.isArray(fees)
      ? fees.map((f) => Number(f?.prioritizationFee ?? 0)).filter((n) => Number.isFinite(n) && n >= 0)
      : [];

    const defaultMicroLamports = 5_000;   // 5k microLamports/CU baseline
    const minMicroLamports = 2_000;       // floor
    const maxMicroLamports = 50_000;      // ceiling

    let rec = defaultMicroLamports;
    if (values.length >= 8) {
      const sorted = values.sort((a,b)=>a-b);
      const idx = Math.floor(0.8 * (sorted.length - 1)); // p80
      rec = sorted[idx] || defaultMicroLamports;
      // Normalize: prioritizationFee is per tx unit in some RPCs; we treat it as microLamports/CU directly.
      // Clamp to window:
      rec = Math.max(minMicroLamports, Math.min(maxMicroLamports, rec));
    }

    // Also recommend a compute unit limit, tuned for claim + withdraw
    const cuLimit = 600_000; // safe headroom; adjust if your instructions are lighter/heavier

    res.status(200).json({ ok: true, microLamports: rec, cuLimit, source: values.length ? "recentFees" : "default" });
  } catch (e:any) {
    res.status(200).json({ ok: true, microLamports: 5_000, cuLimit: 600_000, source: "fallback" });
  }
}
