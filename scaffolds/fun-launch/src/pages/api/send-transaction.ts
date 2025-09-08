// scaffolds/fun-launch/src/pages/api/send-transaction.ts
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Transaction,
  PublicKey,
  SystemProgram,
  SystemInstruction,
  ComputeBudgetProgram,
  Commitment,
  SendTransactionError,
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
function bad(
  res: NextApiResponse,
  code: number,
  msg: string,
  extra?: Record<string, unknown>
) {
  return res.status(code).json({ error: msg, where: "send-transaction", ...extra });
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
    // Default 0.035 SOL if a single receiver is provided (matches your previous behavior)
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

// ---------- helpers ----------
async function absoluteApiUrl(req: NextApiRequest, path: string): Promise<string> {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    "https";
  const host = (req.headers.host as string | undefined) || "localhost:3000";
  return `${proto}://${host}${path}`;
}

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return bad(res, 405, "Method not allowed");

  try {
    const body = (req.body ?? {}) as SingleTxBody & BundleBody;
    const connection = new Connection(RPC_URL, COMMITMENT);
    const expectedSplits = getFeeSplitsFromEnv();

    // ---------- Path A: forward a bundle (CREATE + DEV BUY) ----------
    if (Array.isArray(body.signedTransactions) && body.signedTransactions.length > 0) {
      const tx0b64 = (body.signedTransactions[0] ?? "").trim();
      if (!tx0b64) return bad(res, 400, "First bundle transaction is empty");

      // Decode first tx to validate fee-splits
      let tx0: Transaction;
      try {
        tx0 = Transaction.from(Buffer.from(tx0b64, "base64"));
      } catch {
        return bad(res, 400, "First bundle transaction could not be decoded");
      }
      try {
        validateCreationFeeTransfers(tx0, expectedSplits);
      } catch (e: any) {
        return bad(res, 400, e?.message || "Creation fee validation failed");
      }

      // Convert base64 → base58 (raw tx bytes) for the bundle forwarder
      const base58Bundle = body.signedTransactions.map((b64) => {
        const raw = Buffer.from(String(b64), "base64");
        return bs58.encode(raw);
      });

      // Use an absolute URL (relative fetch inside an API route is unreliable)
      const url = await absoluteApiUrl(req, "/api/dbc/send-bundle");
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base58Bundle }),
      });

      // Read once as text; parse if JSON, else include text in error
      const rawText = await r.text();
      try {
        const parsed: any = JSON.parse(rawText);
        if (!r.ok || parsed?.error || parsed?.ok === false) {
          return bad(res, 502, parsed?.error || "Bundle forward failed", {
            providerResponse: parsed,
            mode: "bundle",
          });
        }
        return res.status(200).json({
          success: true,
          mode: "bundle",
          bundleId: parsed?.bundleId,
        });
      } catch {
        return bad(res, 502, "Forwarder returned non-JSON", {
          forwarderText: rawText,
          mode: "bundle",
        });
      }
    }

    // ---------- Path B: single tx send ----------
    const { signedTransaction, waitForLanded } = body;
    if (!signedTransaction) return bad(res, 400, "Missing signed transaction");

    const tx = Transaction.from(Buffer.from(signedTransaction, "base64"));

    try {
      validateCreationFeeTransfers(tx, expectedSplits);
    } catch (e: any) {
      return bad(res, 400, e?.message || "Creation fee validation failed");
    }

    // Send with preflight ON so we can capture helpful logs
    let signature: string;
    try {
      signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: COMMITMENT,
        maxRetries: 3,
      });
    } catch (e: any) {
      // Try to surface preflight logs
      try {
        if (e instanceof SendTransactionError && typeof e.getLogs === "function") {
          const logs = await e.getLogs();
          if (logs?.length) {
            // eslint-disable-next-line no-console
            console.error("Preflight logs:", logs);
            return bad(res, 502, "Preflight failed", { logs, mode: "single" });
          }
        }
      } catch {}
      // Fallback: simulate to dump logs
      try {
        const sim = await connection.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
        });
        // eslint-disable-next-line no-console
        console.error("Sim logs:", sim.value.logs);
        return bad(res, 502, "Preflight failed (simulated)", {
          logs: sim.value.logs,
          simErr: sim.value.err,
          mode: "single",
        });
      } catch (simErr: any) {
        // eslint-disable-next-line no-console
        console.error("Simulation failed:", simErr);
        return bad(res, 502, "Preflight failed (no logs)", { mode: "single" });
      }
    }

    if (waitForLanded) {
      // Confirm by signature (don’t mix blockhash if tx was pre-signed elsewhere)
      const conf = await connection.confirmTransaction(signature, COMMITMENT);
      if (conf.value.err) {
        return bad(res, 502, "Transaction reverted", {
          signature,
          err: conf.value.err,
          mode: "single",
        });
      }
    }

    return res.status(200).json({ success: true, signature, mode: "single" });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error("Transaction error:", error);
    return bad(res, 500, error?.message || "Unknown error");
  }
}
