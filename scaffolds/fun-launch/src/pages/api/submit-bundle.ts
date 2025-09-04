import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, VersionedTransaction, Transaction } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL as string | undefined;
// Optional future relay integration:
// const JITO_BUNDLE_RPC = process.env.JITO_BUNDLE_RPC as string | undefined;

function sanitize(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\u200B/g, "");
}

type SubmitBundleRequest = {
  /** Signed base64 transactions in landing order: [createPoolTx, swapTx1, swapTx2, ...] */
  txs: string[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!sanitize(RPC_URL)) throw new Error("RPC_URL not configured");

    const { txs } = req.body as SubmitBundleRequest;
    if (!txs || !Array.isArray(txs) || txs.length === 0) {
      return res.status(400).json({ error: "No transactions provided" });
    }

    const connection = new Connection(sanitize(RPC_URL as string), "confirmed");

    // Simple, reliable path: send sequentially (already signed)
    const signatures: string[] = [];
    for (const b64 of txs) {
      const raw = Buffer.from(sanitize(b64), "base64");

      // Support both v0 and legacy transactions
      let sig: string;
      try {
        const vtx = VersionedTransaction.deserialize(raw);
        sig = await connection.sendRawTransaction(vtx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch {
        const ltx = Transaction.from(raw);
        sig = await connection.sendRawTransaction(ltx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });
      }
      signatures.push(sig);
    }

    // Optional: true bundle via a relay (kept commented to avoid any runtime errors)
    // if (JITO_BUNDLE_RPC) {
    //   await fetch(JITO_BUNDLE_RPC, {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify({
    //       jsonrpc: "2.0",
    //       id: 1,
    //       method: "sendBundle",
    //       params: [ txs ], // array of signed base64 txs
    //     }),
    //   });
    // }

    return res.status(200).json({ success: true, signatures });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("submit-bundle error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
