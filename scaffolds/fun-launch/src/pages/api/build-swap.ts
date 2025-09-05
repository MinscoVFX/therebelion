import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";

// ---------- STRICT ENV ----------
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
function parseSolToLamports(label: string, solStr: string): bigint {
  const s = sanitize(solStr);
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

type BuildSwapRequest = {
  /** Base token mint (the token you launched) */
  baseMint: string;
  /** Wallet that will buy and sign this swap tx */
  payer: string;
  /** SOL amount as string, e.g. "0.5" */
  amountSol: string;
  /** Pool address (deterministic / returned by /api/upload) */
  pool: string;
  /** Optional: slippage bps (default 100 = 1%) */
  slippageBps?: number;

  /** --- New for bundle / prelaunch flow --- */
  /** If true, do NOT wait for pool existence (for create+buy bundle) */
  prelaunch?: boolean;
  /** If provided, use this recentBlockhash (must match the create-pool tx for bundle) */
  blockhash?: string;

  /** Legacy only: how long to wait for pool to exist (ms). Defaults 8000 if prelaunch=false */
  waitMs?: number;
  /** Legacy only: poll interval (ms). Defaults 150 if prelaunch=false */
  checkIntervalMs?: number;
};

async function waitForPoolAccount(
  connection: Connection,
  pool: PublicKey,
  waitMs = 8000,
  checkIntervalMs = 150
): Promise<void> {
  const start = Date.now();

  const first = await connection.getAccountInfo(pool, "processed");
  if (first) return;

  while (Date.now() - start < waitMs) {
    await new Promise((r) => setTimeout(r, checkIntervalMs));
    const info = await connection.getAccountInfo(pool, "processed");
    if (info) return;
  }
  throw new Error(`Pool not found after waiting ${waitMs}ms: ${pool.toBase58()}`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      baseMint,
      payer,
      amountSol,
      pool,
      slippageBps,
      prelaunch = false,
      blockhash,
      waitMs = 8000,
      checkIntervalMs = 150,
    } = (req.body ?? {}) as BuildSwapRequest;

    if (!baseMint || !payer || !amountSol || !pool) {
      return res
        .status(400)
        .json({ error: "Missing required fields (baseMint, payer, amountSol, pool)" });
    }

    // validate inputs
    parsePubkey("baseMint", baseMint);
    const owner = parsePubkey("payer", payer);
    const poolAddress = parsePubkey("pool", pool);
    const amountInLamports = parseSolToLamports("amountSol", amountSol);
    const slippage = Number.isFinite(slippageBps) && slippageBps! > 0 ? slippageBps! : 100;

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const dbc = new DynamicBondingCurveClient(connection, "confirmed");

    // -------- prelaunch vs legacy --------
    // In prelaunch mode we DO NOT wait for pool existence; this lets us build a swap
    // that can land atomically with the create-pool tx inside a Jito bundle.
    if (!prelaunch) {
      await waitForPoolAccount(connection, poolAddress, waitMs, checkIntervalMs);
    }

    // Build swap via SDK. We set minimumAmountOut = 0 to avoid quoting before pool exists.
    // swapBaseForQuote = false means we spend quote (SOL) to buy base token.
    const swapTx: Transaction = await (dbc as any).pool.swap({
      owner,
      pool: poolAddress,
      amountIn: new BN(amountInLamports.toString()),
      minimumAmountOut: new BN(0),
      swapBaseForQuote: false,
      referralTokenAccount: null,
      slippageBps: slippage,
    });

    // Use shared blockhash if provided (bundle requirement), else fetch a fresh one.
    if (blockhash && blockhash.trim().length > 0) {
      swapTx.recentBlockhash = blockhash.trim();
    } else {
      const { blockhash: fresh } = await connection.getLatestBlockhash("confirmed");
      swapTx.recentBlockhash = fresh;
    }
    swapTx.feePayer = owner;

    const b64 = swapTx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    return res.status(200).json({
      success: true,
      swapTx: b64,
      pool: poolAddress.toBase58(),
      prelaunch,
      usedBlockhash: swapTx.recentBlockhash,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("build-swap error:", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
