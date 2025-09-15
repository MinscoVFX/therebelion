import { Connection } from "@solana/web3.js";
import type { NextApiRequest, NextApiResponse } from "next";
import { getEnv } from "../../src/env/required";
import { resolveRpc } from "../../src/lib/rpc";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const env = getEnv();
    const ping = new Connection(resolveRpc());
    const ver = await ping.getVersion();
  // Allowed IDs existence check (string includes official ids per schema requirement)
  const dbcAllowOk = Boolean(env.ALLOWED_DBC_PROGRAM_IDS);
  const dammAllowOk = Boolean(env.ALLOWED_DAMM_V2_PROGRAM_IDS);
    res.status(200).json({
      ok: true,
      rpc: { cluster: (ver as any)["solana-core"] ?? (ver as any).solana_core ?? "ok" },
      env: {
  dbcSelector: env.DBC_CLAIM_FEE_DISCRIMINATOR ? "disc" : (env.DBC_CLAIM_FEE_INSTRUCTION_NAME || "auto"),
        dbcAllowOk,
        dammAllowOk
      }
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: err });
  }
}
