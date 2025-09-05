import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Transaction,
  PublicKey,
  SystemProgram,
  SystemInstruction,
  sendAndConfirmRawTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL as string | undefined;

// ---------- tiny utils ----------
function sanitize(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\u200B/g, "");
}
function parsePubkey(label: string, value: string): PublicKey {
  const v = sanitize(value);
  try { return new PublicKey(v); } catch { throw new Error(`${label} is not a valid base58 pubkey: "${v}"`); }
}
// coerce header values to a plain string (no unions)
function headerAsString(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return fallback;
}

type FeeSplit = { receiver: PublicKey; lamports: number };
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Same parsing rules as the client util */
function getFeeSplitsFromEnv(): FeeSplit[] {
  const rawMulti = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVERS);
  const rawSingle = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER);

  if (rawMulti) {
    return rawMulti
      .split(",")
      .map((s) => sanitize(s))
      .filter(Boolean)
      .map((pair) => {
        const [addrRaw, solRaw] = pair.split(":");
        const addr = sanitize(addrRaw);
        const solStr = sanitize(solRaw);
        if (!addr || !solStr) throw new Error(`Invalid fee split format: "${pair}". Use "Wallet:0.020"`);
        const receiver = parsePubkey("Fee receiver", addr);
        const sol = parseFloat(solStr);
        if (!Number.isFinite(sol) || sol <= 0) throw new Error(`Invalid SOL amount in split "${pair}"`);
        return { receiver, lamports: Math.floor(sol * LAMPORTS_PER_SOL) };
      });
  }

  if (rawSingle) {
    return [{ receiver: parsePubkey("NEXT_PUBLIC_CREATION_FEE_RECEIVER", rawSingle), lamports: 35_000_000 }];
  }

  throw new Error(
    'Missing fee receivers. Set NEXT_PUBLIC_CREATION_FEE_RECEIVERS="Wallet:0.020,Wallet:0.015" or NEXT_PUBLIC_CREATION_FEE_RECEIVER="Wallet"'
  );
}

// ---------- STRICT RPC narrowing ----------
const RPC_ENDPOINT: string = sanitize(RPC_URL);
if (!RPC_ENDPOINT) {
  throw new Error("RPC_URL not configured");
}

// ---------- request bodies ----------
type SingleTxBody = {
  signedTransaction?: string; // base64-encoded signed transaction
  waitForLanded?: boolean;    // ignored on single path (kept for symmetry)
};
type BundleBody = {
  signedTransactions?: string[]; // 1–5 base64 txs (Tx0 must include creation fee ixs)
  waitForLanded?: boolean;
};

// ---------- shared validation ----------
function validateCreationFeeTransfers(tx: Transaction, expectedSplits: FeeSplit[]) {
  const ixs = tx.instructions ?? [];
  if (ixs.length === 0) throw new Error("Transaction has no instructions");

  // Skip any leading ComputeBudget instructions
  let idx = 0;
  while (idx < ixs.length && ixs[idx]?.programId.equals(ComputeBudgetProgram.programId)) {
    idx++;
  }

  // Determine the payer (feePayer or first signer)
  const payer = tx.feePayer ?? (tx.signatures[0]?.publicKey as PublicKey | undefined);
  if (!payer) throw new Error("Missing payer (feePayer/signers) on transaction");

  // Validate that the next N instructions are SystemProgram.transfer matching expected splits in order
  for (let s = 0; s < expectedSplits.length; s++) {
    const ix = ixs[idx + s];
    if (!ix) throw new Error("Missing creation fee instruction(s)");

    const exp = expectedSplits[s];
    if (!exp) throw new Error("Fee split index out of bounds");

    if (!ix.programId.equals(SystemProgram.programId)) {
      throw new Error("Creation fee ix is not SystemProgram.transfer");
    }
    let decoded: any;
    try {
      decoded = SystemInstruction.decodeTransfer(ix);
    } catch {
      throw new Error("Creation fee ix is not a valid SystemProgram.transfer");
    }
    const toOk = (decoded.toPubkey as PublicKey).equals(exp.receiver);
    const lamportsOk = Number(decoded.lamports) === exp.lamports;
    const fromOk = (decoded.fromPubkey as PublicKey).equals(payer);
    if (!(toOk && lamportsOk && fromOk)) {
      throw new Error(
        `Creation fee check failed at ix ${idx + s}. Expected {from=${payer.toBase58()}, to=${exp.receiver.toBase58()}, lamports=${exp.lamports}}`
      );
    }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = (req.body ?? {}) as SingleTxBody & BundleBody;
    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const expectedSplits = getFeeSplitsFromEnv();

    // ---------- Path A: optional Jito bundle forward ----------
    if (Array.isArray(body.signedTransactions) && body.signedTransactions.length > 0) {
      const tx0b64 = (body.signedTransactions[0] ?? "").trim();
      if (!tx0b64) return res.status(400).json({ error: "First bundle transaction is empty" });

      let tx0: Transaction;
      try {
        tx0 = Transaction.from(Buffer.from(tx0b64, "base64"));
      } catch {
        return res.status(400).json({ error: "First bundle transaction could not be decoded" });
      }

      // validate creation fee on Tx0 using your same rules
      validateCreationFeeTransfers(tx0, expectedSplits);

      // Build absolute URL for the forwarder, with headers coerced to plain strings (no unions)
      const proto = headerAsString(req.headers["x-forwarded-proto"] ?? req.headers["x-forwarded-protocol"], "https");
      const host  = headerAsString(req.headers.host, "localhost:3000");
      const forwardUrl: string = `${proto}://${host}/api/jito-bundle`;

      const r = await fetch(forwardUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          txs: body.signedTransactions,
          waitForLanded: !!body.waitForLanded,
        }),
      });

      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = await r.json();
          msg = (j && (j.error || j.message)) || msg;
        } catch { /* ignore */ }
        return res.status(502).json({ error: msg });
      }

      const out = await r.json();
      return res.status(200).json({
        success: true,
        mode: "bundle",
        bundleId: out?.bundleId,
        status: out?.status,
        region: out?.region,
      });
    }

    // ---------- Path B: legacy single-tx path (unchanged behavior) ----------
    const { signedTransaction } = body;
    if (!signedTransaction) return res.status(400).json({ error: "Missing signed transaction" });

    const tx = Transaction.from(Buffer.from(signedTransaction, "base64"));

    const ixs = tx.instructions ?? [];
    if (ixs.length === 0) {
      return res.status(400).json({ error: "Transaction has no instructions" });
    }

    // Skip any leading ComputeBudget instructions
    let idx = 0;
    while (idx < ixs.length && ixs[idx]?.programId.equals(ComputeBudgetProgram.programId)) {
      idx++;
    }

    // Required fee splits from env (validated + sanitized)
    // (same logic as before, just reusing the computed expectedSplits)
    // Determine the payer (feePayer or first signer)
    const payer = tx.feePayer ?? (tx.signatures[0]?.publicKey as PublicKey | undefined);
    if (!payer) return res.status(400).json({ error: "Missing payer (feePayer/signers) on transaction" });

    // Validate that the next N instructions are SystemProgram.transfer matching expected splits in order
    for (let s = 0; s < expectedSplits.length; s++) {
      const ix = ixs[idx + s];
      if (!ix) return res.status(400).json({ error: "Missing creation fee instruction(s)" });

      const exp = expectedSplits[s];
      if (!exp) {
        return res.status(400).json({ error: "Fee split index out of bounds" });
      }

      if (!ix.programId.equals(SystemProgram.programId)) {
        return res.status(400).json({ error: "Creation fee ix is not SystemProgram.transfer" });
      }
      let decoded: any;
      try {
        decoded = SystemInstruction.decodeTransfer(ix);
      } catch {
        return res.status(400).json({ error: "Creation fee ix is not a valid SystemProgram.transfer" });
      }
      const toOk = (decoded.toPubkey as PublicKey).equals(exp.receiver);
      const lamportsOk = Number(decoded.lamports) === exp.lamports;
      const fromOk = (decoded.fromPubkey as PublicKey).equals(payer);
      if (!(toOk && lamportsOk && fromOk)) {
        return res.status(400).json({
          error: "Creation fee check failed",
          details: {
            index: idx + s,
            expected_to: exp.receiver.toBase58(),
            expected_lamports: exp.lamports,
            expected_from: payer.toBase58(),
          },
        } as any);
      }
    }

    // Optional: allow a memo right after transfers (do not require)
    idx += expectedSplits.length;

    const signature = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
      commitment: "confirmed",
    });

    return res.status(200).json({ success: true, signature, mode: "single" });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Transaction error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
