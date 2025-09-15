import { Connection } from "@solana/web3.js";
import type { NextApiRequest, NextApiResponse } from "next";
import { getEnv } from "@/src/env/required";
import { PROGRAM_IDS } from "@/src/lib/anchor/programs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const env = getEnv();
    const ping = new Connection(env.RPC_URL);
    const ver = await ping.getVersion();
    const dbcAllowOk = env.allowed.dbcIds.includes(PROGRAM_IDS.DBC);
    const dammAllowOk = env.allowed.dammIds.includes(PROGRAM_IDS.CP_AMM);
    res.status(200).json({
      ok: true,
      rpc: { cluster: ver?.solana_core ?? "ok" },
      env: {
        dbcSelector: env.dbcSelector.mode === "disc" ? "hex" : env.dbcSelector.mode,
        dbcAllowOk, dammAllowOk
      }
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
}
