import { Connection } from "@solana/web3.js";
import type { NextApiRequest, NextApiResponse } from "next";
import { getEnv } from "../../src/env/required";
import { resolveRpc } from "../../src/lib/rpc";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const env = getEnv();
    const hasEndpoint = Boolean(process.env.RPC_ENDPOINT);
    const hasRpcUrl = Boolean(process.env.RPC_URL);
    const hasNextPublic = Boolean(process.env.NEXT_PUBLIC_RPC_URL);
    const anyRpc = hasEndpoint || hasRpcUrl || hasNextPublic;
    const ping = new Connection(resolveRpc());
    const ver = await ping.getVersion();
    const cluster = (ver as Record<string, unknown>)["solana-core"] as string || (ver as Record<string, unknown>).solana_core as string || "unknown";
    const warnings: string[] = [];
    if (!anyRpc) warnings.push("NO_RPC_ENV");
    if (!env.ALLOWED_DBC_PROGRAM_IDS) warnings.push("MISSING_ALLOWED_DBC_PROGRAM_IDS");
    if (!env.ALLOWED_DAMM_V2_PROGRAM_IDS) warnings.push("MISSING_ALLOWED_DAMM_V2_PROGRAM_IDS");
    const fatal = !anyRpc; // only absence of RPC is fatal now
    res.status(fatal ? 500 : 200).json({
      ok: !fatal,
      rpc: { cluster },
      env: {
        HAS_RPC_ENDPOINT: hasEndpoint,
        HAS_RPC_URL: hasRpcUrl,
        HAS_NEXT_PUBLIC_RPC_URL: hasNextPublic,
        dbcSelector: env.DBC_CLAIM_FEE_DISCRIMINATOR ? "disc" : (env.DBC_CLAIM_FEE_INSTRUCTION_NAME || "auto"),
        hasAllowedDbcList: Boolean(env.ALLOWED_DBC_PROGRAM_IDS),
        hasAllowedDammList: Boolean(env.ALLOWED_DAMM_V2_PROGRAM_IDS),
        warnings
      }
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: err });
  }
}
