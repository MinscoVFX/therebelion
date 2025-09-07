// scaffolds/fun-launch/src/pages/api/dbc/send-bundle.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * ENV:
 *  - JITO_RELAY_URL : your provider's Jito-enabled JSON-RPC endpoint that supports sendBundle
 *
 * This endpoint only forwards a client-signed bundle to the relay (avoids CORS in the browser).
 * It does NOT sign or mutate any transactions.
 */

const JITO_RELAY_URL = (process.env.JITO_RELAY_URL || "").trim();

type ReqBody = {
  // Base58-encoded transactions, in order (CREATE first, then DEV-BUY)
  // Each element is a base58-encoded serialized VersionedTransaction
  base58Bundle: string[];
};

function bad(res: NextApiResponse, code: number, msg: string, extra?: Record<string, unknown>) {
  return res.status(code).json({ ok: false, error: msg, ...extra });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return bad(res, 405, "Method Not Allowed");
    }
    if (!JITO_RELAY_URL) return bad(res, 500, "Missing JITO_RELAY_URL env");

    const { base58Bundle } = (req.body || {}) as ReqBody;
    if (!Array.isArray(base58Bundle) || base58Bundle.length !== 2) {
      return bad(res, 400, "base58Bundle must be an array of length 2 [createTx, devBuyTx]");
    }
    if (!base58Bundle.every((s) => typeof s === "string" && s.length > 0)) {
      return bad(res, 400, "Every bundle entry must be a non-empty base58 string");
    }

    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [base58Bundle],
    };

    const r = await fetch(JITO_RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await r.json().catch(() => null);

    if (!r.ok || !json || json.error) {
      return bad(res, 502, "sendBundle failed", { providerResponse: json || (await r.text()) });
    }

    return res.status(200).json({ ok: true, bundleId: json.result });
  } catch (e: any) {
    return bad(res, 500, e?.message || "Unexpected error");
  }
}
