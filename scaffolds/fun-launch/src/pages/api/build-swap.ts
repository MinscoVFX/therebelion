// scaffolds/fun-launch/src/pages/api/build-swap.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

/**
 * Stateless SWAP builder for prelaunch/atomic bundles.
 *
 * - ❌ NO on-chain reads of the pool/config/quote (so it works *before* creation).
 * - ✅ minimumAmountOut = 1 (no pre-quote).
 * - ✅ swapBaseForQuote = false (buy base token with SOL).
 * - ✅ Returns a legacy Transaction (base64) assembled from SDK instructions.
 *
 * Request JSON:
 *  {
 *    "baseMint": "<mint>",                 // required (validated, but unused in the build)
 *    "payer": "<wallet pubkey>",           // required
 *    "amountSol": "0.05",                  // required (string or number)
 *    "pool": "<DBC virtual pool pubkey>",  // required (NOT mint, NOT config)
 *    "blockhash": "<opt shared blockhash>" // optional; if omitted we fetch latest
 *  }
 *
 * Response JSON:
 *  {
 *    "ok": true,
 *    "swapTx": "<base64-legacy-transaction>",
 *    "pool": "<pool address>",
 *    "usedBlockhash": "<blockhash>"
 *  }
 */

// ---------- STRICT ENV ----------
const RAW_RPC_URL = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
const RPC_ENDPOINT: string = typeof RAW_RPC_URL === "string" ? RAW_RPC_URL.trim() : "";
if (!RPC_ENDPOINT) throw new Error("RPC_URL (or NEXT_PUBLIC_RPC_URL) not configured");

// ---------- helpers ----------
function sanitize(s?: string | null): string {
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
function parseSolLamports(label: string, input: string | number): bigint {
  const s = typeof input === "number" ? String(input) : sanitize(input);
  if (!s) throw new Error(`${label} must be provided`);
  const dot = s.indexOf(".");
  const intPartRaw = dot === -1 ? s : s.slice(0, dot);
  const fracPartRaw = dot === -1 ? "" : s.slice(dot + 1);
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "") || "0";
  const fracPart = (fracPartRaw + "000000000").slice(0, 9);
  if (!/^\d+$/.test(intPart) || !/^\d{0,9}$/.test(fracPart)) {
    throw new Error(`${label} is not a valid number: "${s}"`);
  }
  const i = BigInt(intPart);
  const f = BigInt(fracPart || "0");
  const lamports = i * 1_000_000_000n + f;
  if (lamports <= 0n) throw new Error(`${label} must be greater than 0`);
  return lamports;
}

// ---------- types ----------
type BuildSwapRequest = {
  baseMint: string;
  payer: string;
  amountSol: string | number;
  pool: string;              // DBC virtual pool address
  blockhash?: string;        // optional shared blockhash (for bundles)
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

    const { baseMint, payer, amountSol, pool, blockhash } = (req.body ?? {}) as BuildSwapRequest;

    // ---- validate inputs (do NOT read on-chain) ----
    if (!baseMint || !payer || amountSol === undefined || amountSol === null || !pool) {
      return bad(res, 400, "Missing required fields (baseMint, payer, amountSol, pool)");
    }

    // Validate pubkeys (baseMint not used in build, but we still sanity-check it)
    parsePubkey("baseMint", baseMint);
    const owner = parsePubkey("payer", payer);
    const poolAddress = parsePubkey("pool", pool);
    const lamportsIn = parseSolLamports("amountSol", amountSol);

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const dbc = new DynamicBondingCurveClient(connection, "confirmed");

    // ---- Build swap WITHOUT reading pool state (no getPool/getConfig/quote) ----
    const swapBuild = await dbc.pool.swap({
      owner,
      pool: poolAddress,
      amountIn: new BN(lamportsIn.toString()),
      minimumAmountOut: new BN(1), // atomic with create; avoid pre-quote
      swapBaseForQuote: false,     // buy base token with SOL
      referralTokenAccount: null,
    });

    // Assemble a legacy transaction from returned instructions
    const tx = new Transaction();
    tx.feePayer = owner;

    // Set recentBlockhash: use provided shared one if present (better for bundles)
    if (blockhash && blockhash.trim().length > 0) {
      tx.recentBlockhash = blockhash.trim();
    } else {
      const { blockhash: fresh } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = fresh;
    }

    for (const ix of swapBuild.instructions) {
      tx.add(ix);
    }

    const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

    return res.status(200).json({
      ok: true,
      swapTx: b64,
      pool: poolAddress.toBase58(),
      usedBlockhash: tx.recentBlockhash,
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("build-swap error:", e);
    return bad(res, 500, e?.message || "Unexpected error");
  }
}
