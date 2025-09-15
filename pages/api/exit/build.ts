import type { NextApiRequest, NextApiResponse } from "next";
import { ComputeBudgetProgram, Connection } from "@solana/web3.js";
import { buildDbcExitTransaction } from "../../../scaffolds/fun-launch/src/server/dbc-exit-builder"; // adjust relative path

interface ExitBuildBody {
  cuLimit?: number;
  microLamports?: number;
  owner?: string;
  dbcPoolKeys?: { pool: string; feeVault: string };
  action?: 'claim' | 'withdraw' | 'claim_and_withdraw';
  simulateOnly?: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const parsed: ExitBuildBody = (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })();
    const { cuLimit: bodyCu, microLamports: bodyFee } = parsed;
    let cuLimit = Number(bodyCu);
    let microLamports = Number(bodyFee);
    if (!Number.isFinite(cuLimit) || !Number.isFinite(microLamports)) {
      try {
        const baseUrl = `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers.host}`;
        const r = await fetch(`${baseUrl}/api/fees/recommend`);
        const j = await r.json();
        cuLimit = Number.isFinite(Number(j?.cuLimit)) ? Number(j.cuLimit) : 600_000;
        microLamports = Number.isFinite(Number(j?.microLamports)) ? Number(j.microLamports) : 5_000;
      } catch {
        cuLimit = 600_000; microLamports = 5_000;
      }
    }
    // Build ComputeBudget instructions
    const computeBudgetIxs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    ];
    // Optional DBC exit transaction build (claim-only currently supported in production usage)
  let exitTxBase64: string | undefined;
  let simulation: { logs: string[]; unitsConsumed: number; error?: unknown } | undefined;
    if (parsed.owner && parsed.dbcPoolKeys?.pool && parsed.dbcPoolKeys?.feeVault) {
  const rpc = process.env.RPC_URL || process.env.RPC_ENDPOINT || process.env.NEXT_PUBLIC_RPC_URL || process.env.TEST_MOCK_RPC || 'https://api.mainnet-beta.solana.com';
      // Allow mock connection for tests when TEST_MOCK_RPC === 'mock'
      const connection = rpc === 'mock'
        ? ({
            getAccountInfo: async () => ({ data: Buffer.alloc(165, 1) }),
            getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 123 }),
            simulateTransaction: async () => ({ value: { logs: [], unitsConsumed: 5000 } }),
          } as unknown as Connection)
        : new Connection(rpc, 'confirmed');
      try {
        const built = await buildDbcExitTransaction(connection, {
          owner: parsed.owner,
          dbcPoolKeys: parsed.dbcPoolKeys,
          action: parsed.action || 'claim',
          simulateOnly: parsed.simulateOnly ?? true,
          computeUnitLimit: cuLimit,
          priorityMicros: microLamports,
        });
        simulation = built.simulation;
        exitTxBase64 = Buffer.from(built.tx.serialize()).toString('base64');
      } catch (e) {
        // Surface error but keep compute budget information
        return res.status(400).json({ ok: false, cuLimit, microLamports, error: e instanceof Error ? e.message : String(e) });
      }
    }
    res.status(200).json({ ok: true, computeBudgetIxs, cuLimit, microLamports, exitTxBase64, simulation });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: err });
  }
}
