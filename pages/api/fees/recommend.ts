import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection } from '@solana/web3.js';
import { getEnv } from '../../../src/env/required';
import { resolveRpc } from '../../../src/lib/rpc';

/**
 * Recommends microLamports per CU using recent block priorities.
 * Strategy:
 * - Read recent prioritization fees and pick p80.
 * - Clamp to a sane min/max window to avoid outrageous spikes.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    getEnv(); // ensure required env validated (result unused)
    const connection = new Connection(resolveRpc(), 'confirmed');

    // recentPrioritizationFees is available on many RPCs (Jito/RPCPool/Helius/Ankr etc.),
    // but we’ll gracefully fall back to static defaults if missing.
    interface PriorityFeeEntry {
      prioritizationFee?: number | string;
      [k: string]: unknown;
    }
    let fees: PriorityFeeEntry[] = [];
    try {
      // Some providers expose getRecentPrioritizationFees; others use getRecentPrioritizationFees({limit})
      // We attempt both patterns.
      const rpcExt = connection as unknown as {
        getRecentPrioritizationFees?: (arg?: unknown) => Promise<PriorityFeeEntry[]>;
      };
      fees =
        (await rpcExt.getRecentPrioritizationFees?.({})) ??
        (await rpcExt.getRecentPrioritizationFees?.()) ??
        [];
    } catch {
      /* ignore fee fetch errors, fallback below */
    }

    const values: number[] = Array.isArray(fees)
      ? fees
          .map((f: PriorityFeeEntry) => Number(f?.prioritizationFee ?? 0))
          .filter((n: number) => Number.isFinite(n) && n >= 0)
      : [];

    const defaultMicroLamports = 5_000; // 5k microLamports/CU baseline
    const minMicroLamports = 2_000; // floor
    const maxMicroLamports = 50_000; // ceiling

    let rec = defaultMicroLamports;
    if (values.length >= 8) {
      const sorted = values.sort((a, b) => a - b);
      const idx = Math.floor(0.8 * (sorted.length - 1)); // p80
      rec = sorted[idx] || defaultMicroLamports;
      // Normalize: prioritizationFee is per tx unit in some RPCs; we treat it as microLamports/CU directly.
      // Clamp to window:
      rec = Math.max(minMicroLamports, Math.min(maxMicroLamports, rec));
    }

    // Also recommend a compute unit limit, tuned for claim + withdraw
    const cuLimit = 600_000; // safe headroom; adjust if your instructions are lighter/heavier

    res.status(200).json({
      ok: true,
      microLamports: rec,
      cuLimit,
      source: values.length ? 'recentFees' : 'default',
    });
  } catch {
    res.status(200).json({ ok: true, microLamports: 5_000, cuLimit: 600_000, source: 'fallback' });
  }
}
