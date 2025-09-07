// scaffolds/fun-launch/src/components/hooks/useAtomicLaunchClientBundle.ts
"use client";

import { useCallback } from "react";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import bs58 from "bs58";

type BuildCreateIxsArgs = {
  // Return create instructions (NOT sent or signed yet).
  // feePayer is optional; we’ll fallback to walletPublicKey if omitted.
  buildCreateIxs: () => Promise<{ ixs: TransactionInstruction[]; feePayer?: PublicKey }>;
};

type AtomicArgs = BuildCreateIxsArgs & {
  connection: Connection;       // same RPC your app uses
  walletPublicKey: PublicKey;   // Phantom pubkey
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;

  // DBC *virtual pool* address you compute/display on the form (NOT mint, NOT config)
  poolAddress: string;

  // How much SOL the dev buys
  devBuyAmountSol: number;

  // Optional: boost both txs
  createPriorityMicroLamports?: number;   // e.g., 100_000
  buyPriorityMicroLamports?: number;      // e.g., 100_000

  // Optional: referral ATA
  referralTokenAccount?: PublicKey;

  // Optional: base mint (only used for server fallback shape)
  baseMint?: PublicKey;
};

const TIP_ACCOUNT = new PublicKey("4ACfpUFoa5D9bfPdeu6DBt89gB6ENteHBXCAi87hNDEE");
const TIP_LAMPORTS = 1_000_000; // 0.001 SOL

export function useAtomicLaunchClientBundle() {
  return useCallback(async (args: AtomicArgs) => {
    const {
      connection,
      walletPublicKey,
      signTransaction,
      buildCreateIxs,
      poolAddress,
      devBuyAmountSol,
      createPriorityMicroLamports = 100_000,
      buyPriorityMicroLamports = 100_000,
      referralTokenAccount,
      baseMint,
    } = args;

    if (!poolAddress) throw new Error("poolAddress is required");
    if (!Number.isFinite(devBuyAmountSol) || devBuyAmountSol <= 0) {
      throw new Error("devBuyAmountSol must be > 0");
    }

    const poolPubkey = new PublicKey(poolAddress);
    const lamportsIn = BigInt(Math.round(devBuyAmountSol * 1e9));

    // ---------- 1) CREATE tx (unsigned instructions) ----------
    const { ixs: createIxs, feePayer } = await buildCreateIxs();
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const createIxsWithCU = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(createPriorityMicroLamports) }),
      ...createIxs,
    ];
    const createMsg = new TransactionMessage({
      payerKey: feePayer ?? walletPublicKey,
      recentBlockhash: blockhash,
      instructions: createIxsWithCU,
    }).compileToV0Message();
    const createTx = new VersionedTransaction(createMsg);

    // ---------- 2) DEV-BUY ----------
    // First attempt: client-side SDK (fast path). If it throws "Pool not found",
    // fall back to server /api/build-swap which never pre-reads.
    let buyTxV0: VersionedTransaction | null = null;
    try {
      const dbc = new DynamicBondingCurveClient(connection, "confirmed");
      const swapTx = await dbc.pool.swap({
        amountIn: new BN(lamportsIn.toString()),
        minimumAmountOut: new BN(1), // atomic with create
        swapBaseForQuote: false,     // buy token with SOL
        owner: walletPublicKey,
        pool: poolPubkey,
        referralTokenAccount: referralTokenAccount ?? null,
      });

      const tipIxn = SystemProgram.transfer({
        fromPubkey: walletPublicKey,
        toPubkey: TIP_ACCOUNT,
        lamports: TIP_LAMPORTS,
      });

      const buyIxsWithCU = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(buyPriorityMicroLamports) }),
        ...swapTx.instructions,
        tipIxn,
      ];

      const buyMsg = new TransactionMessage({
        payerKey: walletPublicKey,
        recentBlockhash: blockhash,
        instructions: buyIxsWithCU,
      }).compileToV0Message();

      buyTxV0 = new VersionedTransaction(buyMsg);
    } catch (e: any) {
      const msg = String(e?.message || e);
      const looksLikePoolNotFound = /Pool not found/i.test(msg);

      if (!looksLikePoolNotFound) {
        // Surface the actual client-side error
        throw new Error(msg);
      }

      // ---------- 2b) Fallback: ask server to build swap (stateless), then reconstruct a v0 tx ----------
      const resp = await fetch("/api/build-swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseMint: (baseMint ?? walletPublicKey).toBase58(), // not used server-side except validation
          payer: walletPublicKey.toBase58(),
          amountSol: (Number(devBuyAmountSol)).toString(),
          pool: poolAddress,
          blockhash, // share the same blockhash for better bundle coherency
        }),
      });

      // If server failed, try to show its `where` field
      const json = await resp.json().catch(() => null as any);
      if (!resp.ok || !json?.ok) {
        const serverErr =
          (json && (json.error || json?.providerResponse?.error?.message)) ||
          `build-swap failed (HTTP ${resp.status})`;
        // Preserve origin tag if provided
        const where = json?.where ? ` [from ${json.where}]` : "";
        throw new Error(`${serverErr}${where}`);
      }

      // json.swapTx is base64 (legacy Transaction). Convert → instructions → v0 transaction.
      const legacy = Transaction.from(Buffer.from(json.swapTx, "base64"));

      // Append tip instruction (server does not add it)
      legacy.add(
        SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: TIP_ACCOUNT,
          lamports: TIP_LAMPORTS,
        })
      );

      const ixs = [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(buyPriorityMicroLamports) }),
        ...legacy.instructions,
      ];

      // Keep using the same blockhash we used for CREATE
      const buyMsg = new TransactionMessage({
        payerKey: walletPublicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();

      buyTxV0 = new VersionedTransaction(buyMsg);
    }

    // ---------- 3) Phantom signs BOTH ----------
    const [signedCreate, signedBuy] = await Promise.all([
      signTransaction(createTx),
      signTransaction(buyTxV0!),
    ]);

    // ---------- 4) sendBundle via our tiny proxy ----------
    const bundleBase58 = [signedCreate, signedBuy].map((tx) => bs58.encode(tx.serialize()));
    const r = await fetch("/api/dbc/send-bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base58Bundle: bundleBase58 }),
    });

    let json: any = null;
    try {
      json = await r.json();
    } catch {
      throw new Error(`Bundle forward failed (non-JSON, status ${r.status})`);
    }

    if (!r.ok || !json || !json.ok) {
      const errMsg =
        (json && (json.error || json.providerResponse?.error?.message)) ||
        `Bundle forward failed (status ${r.status})`;
      const where = json?.where ? ` [from ${json.where}]` : "";
      throw new Error(`${errMsg}${where}`);
    }

    return json as { ok: true; bundleId: string };
  }, []);
}
