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

// ---------- STRICT ENV NARROWING ----------
const RAW_RPC_URL = process.env.RPC_URL;
const RPC_ENDPOINT: string = typeof RAW_RPC_URL === "string" ? RAW_RPC_URL.trim() : "";
if (!RPC_ENDPOINT) {
  throw new Error("RPC_URL not configured");
}

// ---------- helpers ----------
function sanitize(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\u200B/g, "");
}
function parsePubkey(label: string, value: string): PublicKey {
  const v = sanitize(value);
  try {
    return new PublicKey(v);
  } catch {
    throw new Error(`${label} is not a valid base58 pubkey: "${v}"`);
  }
}

type FeeSplit = { receiver: PublicKey; lamports: number };
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Same parsing rules as the client/util */
function getFeeSplitsFromEnv(): FeeSplit[] {
  const rawMulti = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVERS);
  const rawSingle = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER);

  if (rawMulti) {
    return rawMulti
      .split(",")
      .map((s) => sanitize(s))
      .filter(Boolean)
      .map((pair) => {
        const colon = pair.indexOf(":");
        const addr = colon === -1 ? "" : sanitize(pair.slice(0, colon));
        const solStr = colon === -1 ? "" : sanitize(pair.slice(colon + 1));
        if (!addr || !solStr)
          throw new Error(`Invalid fee split format: "${pair}". Use "Wallet:0.020"`);
        const receiver = parsePubkey("Fee receiver", addr);
        const sol = parseFloat(solStr);
        if (!Number.isFinite(sol) || sol <= 0)
          throw new Error(`Invalid SOL amount in split "${pair}"`);
        return { receiver, lamports: Math.floor(sol * LAMPORTS_PER_SOL) };
      });
  }

  if (rawSingle) {
    return [
      {
        receiver: parsePubkey("NEXT_PUBLIC_CREATION_FEE_RECEIVER", rawSingle),
        lamports: 35_000_000,
      },
    ];
  }

  throw new Error(
    'Missing fee receivers. Set NEXT_PUBLIC_CREATION_FEE_RECEIVERS="Wallet:0.020,Wallet:0.015" or NEXT_PUBLIC_CREATION_FEE_RECEIVER="Wallet"'
  );
}

type SingleTxBody = {
  signedTransaction?: string; // base64
  waitForLanded?: boolean;
};
type BundleBody = {
  signedTransactions?: string[]; // 1–5 base64, ordered (e.g., [createPool, devBuy])
  waitForLanded?: boolean;
};

function decodeTransactionOrThrow(b64: string): Transaction {
  const trimmed = (b64 ?? "").trim();
  if (!trimmed) throw new Error("Transaction base64 string is empty");
  try {
    return Transaction.from(Buffer.from(trimmed, "base64"));
  } catch {
    throw new Error("Invalid signed transaction (base64 decode failed)");
  }
}

/**
 * Validate creation-fee SystemProgram.transfer instructions that must appear
 * immediately after any leading ComputeBudget ixs.
 *
 * We validate ONLY in the first transaction of the bundle (Tx 0).
 */
function validateCreationFeeTransfers(tx: Transaction, expectedSplits: FeeSplit[]) {
  const ixs = tx.instructions ?? [];
  if (ixs.length === 0) throw new Error("Transaction has no instructions");

  // Skip any leading ComputeBudget instructions
  let idx = 0;
  while (idx < ixs.length && ixs[idx]?.programId.equals(ComputeBudgetProgram.programId)) {
    idx++;
  }

  // Determine the payer (feePayer or first signer)
  const payer =
    tx.feePayer ?? (tx.signatures[0]?.publicKey as PublicKey | undefined);
  if (!payer) throw new Error("Missing payer (feePayer/signers) on transaction");

  // Validate that the next N instructions are SystemProgram.transfer in order
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = (req.body ?? {}) as SingleTxBody & BundleBody;

    // Construct Connection with strictly narrowed endpoint (plain string)
    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const expectedSplits = getFeeSplitsFromEnv();

    // -------- Path A: Bundle submission (recommended) --------
    if (Array.isArray(body.signedTransactions) && body.signedTransactions.length > 0) {
      const signedTransactions = body.signedTransactions;

      // Decode Tx 0 only for fee validation
      const tx0 = decodeTransactionOrThrow(signedTransactions[0]);
      validateCreationFeeTransfers(tx0, expectedSplits);

      // Build a guaranteed-plain-string URL for the local forwarder (no header unions)
      const port = String(process.env.PORT ?? "3000");
      const forwardUrl = `http://127.0.0.1:${port}/api/jito-bundle`;

      const r = await fetch(forwardUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          txs: signedTransactions,
          waitForLanded: !!body.waitForLanded,
        }),
      });

      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const err = await r.json();
          msg = (err && (err.error || err.message)) || msg;
        } catch {
          // ignore JSON parse errors
        }
        return res.status(502).json({ error: String(msg) });
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

    // -------- Path B: Single transaction (legacy) --------
    const { signedTransaction } = body;
    if (!signedTransaction)
      return res.status(400).json({
        error:
          "Missing signed transaction. Provide { signedTransaction } for legacy path or { signedTransactions: [] } for bundle.",
      });

    const tx = decodeTransactionOrThrow(signedTransaction);
    validateCreationFeeTransfers(tx, expectedSplits);

    const signature = await sendAndConfirmRawTransaction(
      connection,
      tx.serialize(),
      { commitment: "confirmed" }
    );

    return res.status(200).json({ success: true, mode: "single", signature });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Transaction error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
