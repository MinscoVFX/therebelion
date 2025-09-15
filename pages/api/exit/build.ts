import type { NextApiRequest, NextApiResponse } from "next";
import { ComputeBudgetProgram } from "@solana/web3.js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { owner, cuLimit: bodyCu, microLamports: bodyFee } = JSON.parse(req.body || "{}");
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
    // TODO: Add claim+withdraw instructions here
    res.status(200).json({ ok: true, computeBudgetIxs, cuLimit, microLamports });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
}
