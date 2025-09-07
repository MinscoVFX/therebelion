// scaffolds/fun-launch/src/pages/api/jito-bundle.ts
import type { NextApiRequest, NextApiResponse } from "next";
import bs58 from "bs58";

/**
 * Compatibility shim:
 * - GET ?tipAccounts=1: returns a small curated list of Helius/Jito tip accounts so the client
 *   can pick one when sending bundles to https://sender.helius-rpc.com/fast.
 * - POST { txs: base64[] } : forwards to our canonical /api/dbc/send-bundle after converting to base58.
 *
 * NOTE: New code should POST directly to /api/dbc/send-bundle with { base58Bundle }.
 */

function bad(
  res: NextApiResponse,
  code: number,
  msg: string,
  extra?: Record<string, unknown>
) {
  return res.status(code).json({ ok: false, error: msg, where: "jito-bundle", ...extra });
}

const DEFAULT_TIP_ACCOUNTS = [
  // Public tip accounts (rotate/update as desired)
  "4ACfpUFoa5D9bfPdeu6DBt89gB6ENteHBXCAi87hNDEE",
  "7Z1C7h7CmxLQzW5fF8E8soQwQy6uTSZgkzcoUqk8sSxh",
  "6yV16Lw9h1z6w8Q2i2qQ4y2sP9udYw9a7iWQeBnU4qvf",
].filter(Boolean);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // -------- GET: tip accounts helper --------
    if (req.method === "GET") {
      const wantTips = String(req.query.tipAccounts ?? "").trim();
      if (wantTips === "1" || wantTips.toLowerCase() === "true") {
        return res.status(200).json({ ok: true, tipAccounts: DEFAULT_TIP_ACCOUNTS });
      }
      return bad(res, 400, "Pass ?tipAccounts=1 to fetch tip accounts");
    }

    // -------- POST: legacy bundle forward (base64 -> base58 -> /api/dbc/send-bundle) --------
    if (req.method === "POST") {
      const { txs } = (req.body ?? {}) as { txs?: string[] };
      if (!Array.isArray(txs) || txs.length < 2) {
        return bad(res, 400, "Provide txs: base64[] with at least 2 signed transactions");
      }

      // Convert base64 -> base58 for the canonical forwarder
      const base58Bundle = txs.map((b64) => {
        const raw = Buffer.from(String(b64), "base64");
        return bs58.encode(raw);
      });

      const r = await fetch("/api/dbc/send-bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base58Bundle }),
      });

      // Read once as text, then parse (lint-friendly; avoids let-reassignment)
      const raw = await r.text();
      try {
        const parsed: any = JSON.parse(raw);

        if (!r.ok || parsed?.error || parsed?.ok === false) {
          return bad(res, 502, "Bundle forward failed", { forwarderResponse: parsed });
        }
        return res.status(200).json({ ok: true, bundleId: parsed?.bundleId ?? null });
      } catch {
        return bad(res, 502, "Forwarder returned non-JSON", { forwarderText: raw });
      }
    }

    res.setHeader("Allow", "GET, POST");
    return bad(res, 405, "Method Not Allowed");
  } catch (e: any) {
    return bad(res, 500, e?.message || "Unexpected error");
  }
}
