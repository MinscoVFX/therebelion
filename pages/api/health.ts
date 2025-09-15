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
    const dbcAllowOk = Boolean(env.ALLOWED_DBC_PROGRAM_IDS);
    const dammAllowOk = Boolean(env.ALLOWED_DAMM_V2_PROGRAM_IDS);
    const errors: string[] = [];
    if (!anyRpc) errors.push("NO_RPC_ENV");
    if (!dbcAllowOk) errors.push("MISSING_ALLOWED_DBC_PROGRAM_IDS");
    if (!dammAllowOk) errors.push("MISSING_ALLOWED_DAMM_V2_PROGRAM_IDS");
    const ok = errors.length === 0;
    const statusCode = ok ? 200 : 500;
    res.status(statusCode).json({
      ok,
      rpc: { cluster },
      env: {
        HAS_RPC_ENDPOINT: hasEndpoint,
        HAS_RPC_URL: hasRpcUrl,
        HAS_NEXT_PUBLIC_RPC_URL: hasNextPublic,
        dbcSelector: env.DBC_CLAIM_FEE_DISCRIMINATOR ? "disc" : (env.DBC_CLAIM_FEE_INSTRUCTION_NAME || "auto"),
        dbcAllowOk,
        dammAllowOk,
        errors
      }
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: err });
  }
}
