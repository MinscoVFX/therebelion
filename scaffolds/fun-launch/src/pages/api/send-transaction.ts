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

function sanitize(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\u200B/g, "");
}
function parsePubkey(label: string, value: string): PublicKey {
  const v = sanitize(value);
  try { return new PublicKey(v); } catch { throw new Error(`${label} is not a valid base58 pubkey: "${v}"`); }
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

if (!sanitize(RPC_URL)) {
  throw new Error("RPC_URL not configured");
}

type SendTransactionRequest = {
  signedTransaction: string; // base64-encoded signed transaction
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { signedTransaction } = req.body as SendTransactionRequest;
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
    const expectedSplits = getFeeSplitsFromEnv();

    // Determine the payer (feePayer or first signer)
    const payer = tx.feePayer ?? (tx.signatures[0]?.publicKey as PublicKey | undefined);
    if (!payer) return res.status(400).json({ error: "Missing payer (feePayer/signers) on transaction" });

    // Validate that the next N instructions are SystemProgram.transfer matching expected splits in order
    for (let s = 0; s < expectedSplits.length; s++) {
      const ix = ixs[idx + s];
      if (!ix) return res.status(400).json({ error: "Missing creation fee instruction(s)" });
      if (!ix.programId.equals(SystemProgram.programId)) {
        return res.status(400).json({ error: "Creation fee ix is not SystemProgram.transfer" });
      }
      let decoded;
      try {
        decoded = SystemInstruction.decodeTransfer(ix);
      } catch {
        return res.status(400).json({ error: "Creation fee ix is not a valid SystemProgram.transfer" });
      }
      const exp = expectedSplits[s];
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
    // If you want to assert memo presence/content, do it here (skipped by default).
    idx += expectedSplits.length;

    const connection = new Connection(sanitize(RPC_URL as string), "confirmed");
    const signature = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
      commitment: "confirmed",
    });

    return res.status(200).json({ success: true, signature });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Transaction error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
