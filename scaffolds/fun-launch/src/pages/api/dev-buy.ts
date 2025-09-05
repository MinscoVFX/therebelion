// scaffolds/fun-launch/src/pages/api/dev-buy.ts
import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  Transaction,
} from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import bs58 from "bs58";

/**
 * ENV REQUIRED (server-only):
 * - RPC_URL
 * - DEV_PRIVATE_KEY_B58        // base58-encoded 64-byte secret key
 *
 * Optional:
 * - COMMITMENT ("confirmed" | "finalized"), default "confirmed"
 */
const RPC_URL = (process.env.RPC_URL || "").trim();
const DEV_PRIVATE_KEY_B58 = (process.env.DEV_PRIVATE_KEY_B58 || "").trim();
const COMMITMENT = (process.env.COMMITMENT as "processed" | "confirmed" | "finalized") || "confirmed";

function bad(res: NextApiResponse, status: number, message: string, extra?: Record<string, unknown>) {
  return res.status(status).json({ ok: false, error: message, ...extra });
}

function parsePubkey(label: string, value?: string) {
  if (!value) throw new Error(`${label} is required`);
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new Error(`${label} is not a valid base58 pubkey: "${value}"`);
  }
}

function parseLamports(label: string, solLike?: number | string) {
  if (solLike === undefined || solLike === null || solLike === "") {
    throw new Error(`${label} is required`);
  }
  const n = typeof solLike === "string" ? Number(solLike) : solLike;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be > 0`);
  // Use bigint-safe conversion
  const lamports = BigInt(Math.round(n * 1e9));
  return lamports;
}

function loadDevKeypair() {
  if (!DEV_PRIVATE_KEY_B58) throw new Error("Missing DEV_PRIVATE_KEY_B58");
  const secret = bs58.decode(DEV_PRIVATE_KEY_B58);
  return Keypair.fromSecretKey(secret);
}

/**
 * Body:
 * {
 *   poolAddress: string,          // REQUIRED: DBC virtual pool address (NOT mint, NOT config)
 *   amountInSol: number | string, // REQUIRED: SOL to spend
 *   slippageBps?: number,         // default 100 (1%)
 *   priorityMicroLamports?: number, // optional Jito/priority fee, e.g. 100_000
 *   referralTokenAccount?: string // optional SPL token account to collect referral
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return bad(res, 405, "Method Not Allowed");
    }

    if (!RPC_URL) return bad(res, 500, "Missing RPC_URL");

    const {
      poolAddress,
      amountInSol,
      slippageBps = 100,
      priorityMicroLamports,
      referralTokenAccount,
    } = (req.body || {}) as {
      poolAddress?: string;
      amountInSol?: number | string;
      slippageBps?: number;
      priorityMicroLamports?: number;
      referralTokenAccount?: string;
    };

    // Parse inputs
    const poolPubkey = parsePubkey("poolAddress", poolAddress);
    const lamportsIn = parseLamports("amountInSol", amountInSol);
    const hasReferral = !!referralTokenAccount;
    const referralTA = hasReferral ? parsePubkey("referralTokenAccount", referralTokenAccount) : null;

    // Setup
    const connection = new Connection(RPC_URL, COMMITMENT);
    const client = new DynamicBondingCurveClient(connection, COMMITMENT);
    const dev = loadDevKeypair();

    // Validate pool exists (this is where "Pool not found" usually comes from if wrong address)
    const virtualPoolState = await client.state.getPool(poolPubkey);
    if (!virtualPoolState) {
      return bad(res, 400, `Pool not found for address: ${poolPubkey.toBase58()}`, {
        hint:
          "Make sure you are sending the DBC VIRTUAL POOL address returned by the create-pool step. " +
          "This is NOT the token mint or the pool config key.",
      });
    }

    // Load config
    const poolConfigState = await client.state.getPoolConfig(virtualPoolState.config);

    // Defensive: ensure sqrtPrice & curve are sane before quoting
    if (!virtualPoolState.sqrtPrice || virtualPoolState.sqrtPrice.isZero()) {
      return bad(res, 400, "Invalid pool state: sqrtPrice is zero or missing");
    }
    if (!poolConfigState.curve || poolConfigState.curve.length === 0) {
      return bad(res, 400, "Invalid config: curve is empty");
    }

    // Quote the swap (buying token with SOL) to compute minimumAmountOut per slippage
    const quote = await client.pool.swapQuote({
      virtualPool: virtualPoolState,
      config: poolConfigState,
      swapBaseForQuote: false, // buy token with SOL
      amountIn: new BN(lamportsIn.toString()),
      slippageBps,
      hasReferral,
      currentPoint: new BN(0),
    });

    // Build swap tx
    const swapTx = await client.pool.swap({
      amountIn: new BN(lamportsIn.toString()),
      minimumAmountOut: quote.minimumAmountOut,
      swapBaseForQuote: false,
      owner: dev.publicKey,
      pool: poolPubkey,
      referralTokenAccount: referralTA ? referralTA : null,
    });

    // Add compute-unit price priority fee (optional)
    const tx = new Transaction();
    if (priorityMicroLamports && Number(priorityMicroLamports) > 0) {
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: Number(priorityMicroLamports),
        })
      );
    }
    tx.add(...swapTx.instructions);
    tx.feePayer = dev.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(COMMITMENT);
    tx.recentBlockhash = blockhash;

    // Sign + send
    const sig = await sendAndConfirmTransaction(connection, tx, [dev], {
      commitment: COMMITMENT,
      skipPreflight: true,
      maxRetries: 5,
    });

    return res.status(200).json({
      ok: true,
      signature: sig,
      explorer: `https://solscan.io/tx/${sig}`,
      spentLamports: lamportsIn.toString(),
      minOut: quote.minimumAmountOut.toString(),
      priceBefore: quote.price.beforeSwap.toString(),
      priceAfter: quote.price.afterSwap.toString(),
      lastValidBlockHeight,
    });
  } catch (err: any) {
    // Surface helpful errors (including base58 mistakes)
    const message =
      err?.message ||
      (typeof err === "string" ? err : "Unexpected error during dev buy");
    return bad(res, 500, message);
  }
}
