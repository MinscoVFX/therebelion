// scaffolds/fun-launch/src/pages/api/send-transaction.ts
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Transaction,
  PublicKey,
  SystemProgram,
  SystemInstruction,
  sendAndConfirmRawTransaction,
  ComputeBudgetProgram,
  Commitment,
} from "@solana/web3.js";
import bs58 from "bs58";

// ---------- ENV (accept either server or client value for reads/sends) ----------
const RAW_RPC =
  (process.env.RPC_URL as string | undefined) ??
  (process.env.NEXT_PUBLIC_RPC_URL as string | undefined);
const RPC_URL = (RAW_RPC ?? "").trim();
if (!RPC_URL) throw new Error("RPC_URL (or NEXT_PUBLIC_RPC_URL) not configured");

const COMMITMENT: Commitment = (process.env.COMMITMENT as Commitment) || "confirmed";

// ---------- tiny utils ----------
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
    // Default 0.035 SOL if a single receiver is provided (matches your previous behavior)
    return [{ receiver: parsePubkey("NEXT_PUBLIC_CREATION_FEE_RECEIVER", rawSingle), lamports: 35_000_000 }];
  }

  throw new Error(
    'Missing fee receivers. Set NEXT_PUBLIC_CREATION_FEE_RECEIVERS="Wallet:0.020,Wallet:0.015" or NEXT_PUBLIC_CREATION_FEE_RECEIVER="Wallet"'
  );
}

// ---------- request bodies ----------
type SingleTxBody = {
  signedTransaction?: string; // base64-encoded signed transaction
  waitForLanded?: boolean; // only applies to single-sends here
};
type BundleBody = {
  signedTransactions?: string[]; // array of base64 signed txs, sent as a bundle in order
  waitForLanded?: boolean; // ignored for bundle forwarder (Jito/Sender handles landing)
};

// ---------- creation-fee validation ----------
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

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = (req.body ?? {}) as SingleTxBody & BundleBody;
    const connection = new Connection(RPC_URL, COMMITMENT);
    const expectedSplits = getFeeSplitsFromEnv();

    // ---------- Path A: forward a bundle (CREATE + DEV BUY) ----------
    if (Array.isArray(body.signedTransactions) && body.signedTransactions.length > 0) {
      const tx0b64 = (body.signedTransactions[0] ?? "").trim();
      if (!tx0b64) return res.status(400).json({ error: "First bundle transaction is empty" });

      // Decode first tx to validate fee-splits
      let tx0: Transaction;
      try {
        tx0 = Transaction.from(Buffer.from(tx0b64, "base64"));
      } catch {
        return res.status(400).json({ error: "First bundle transaction could not be decoded" });
      }
      validateCreationFeeTransfers(tx0, expectedSplits);

      // Convert base64 → base58 (raw tx bytes) for the bundle forwarder
      const base58Bundle = body.signedTransactions.map((b64) => {
        const raw = Buffer.from(String(b64), "base64");
        return bs58.encode(raw);
      });

      // Forward to our local proxy (no need to compute host headers)
      const r = await fetch("/api/dbc/send-bundle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base58Bundle }),
      });

      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = await r.json();
          msg = (j && (j.error || j.message || j.providerResponse?.error?.message)) || msg;
        } catch {
          // ignore
        }
        return res.status(502).json({ error: msg });
      }

      const out = await r.json();
      return res.status(200).json({
        success: true,
        mode: "bundle",
        bundleId: out?.bundleId,
      });
    }

    // ---------- Path B: single tx send ----------
    const { signedTransaction, waitForLanded } = body;
    if (!signedTransaction) return res.status(400).json({ error: "Missing signed transaction" });

    const tx = Transaction.from(Buffer.from(signedTransaction, "base64"));

    // Validate creation fees on single CREATE path as well
    validateCreationFeeTransfers(tx, expectedSplits);

    const signature = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
      commitment: COMMITMENT,
    });

    // Optionally confirm again (usually redundant after sendAndConfirmRawTransaction)
    if (waitForLanded) {
      const conf = await connection.confirmTransaction(
        { signature, ...(await connection.getLatestBlockhash(COMMITMENT)) },
        COMMITMENT
      );
      if (conf.value.err) {
        return res.status(502).json({ error: "Transaction reverted", signature, err: conf.value.err });
      }
    }

    return res.status(200).json({ success: true, signature, mode: "single" });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error("Transaction error:", error);
    return res.status(500).json({ error: error?.message || "Unknown error" });
  }
}
