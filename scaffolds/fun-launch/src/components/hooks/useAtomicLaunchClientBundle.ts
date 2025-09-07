// scaffolds/fun-launch/src/components/hooks/useAtomicLaunchClientBundle.ts
"use client";

import { useCallback } from "react";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import bs58 from "bs58";

type BuildCreateIxsArgs = {
  // YOU ALREADY HAVE THIS in your flow (whatever you currently do to build create)
  // Return create instructions (NOT sent or signed yet).
  buildCreateIxs: () => Promise<{ ixs: TransactionInstruction[]; feePayer: PublicKey }>;
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
};

/**
 * Pump-style atomic launch:
 *  - create-pool tx signed by Phantom
 *  - dev-buy tx signed by Phantom
 *  - forward both as a Jito bundle (same block, ordered, all-or-nothing)
 */
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
    } = args;

    if (!poolAddress) throw new Error("poolAddress is required");
    if (!Number.isFinite(devBuyAmountSol) || devBuyAmountSol <= 0) {
      throw new Error("devBuyAmountSol must be > 0");
    }

    const poolPubkey = new PublicKey(poolAddress);
    const lamportsIn = BigInt(Math.round(devBuyAmountSol * 1e9));

    // ---------- 1) CREATE tx (unsigned instructions) ----------
    const { ixs: createIxs, feePayer } = await buildCreateIxs();
    const createIxsWithCU = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(createPriorityMicroLamports) }),
      ...createIxs,
    ];
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const createMsg = new TransactionMessage({
      payerKey: feePayer ?? walletPublicKey,
      recentBlockhash: blockhash,
      instructions: createIxsWithCU,
    }).compileToV0Message();
    const createTx = new VersionedTransaction(createMsg);

    // ---------- 2) DEV-BUY (no pre-read; minOut=1) ----------
    const dbc = new DynamicBondingCurveClient(connection, "confirmed");
    const swapTx = await dbc.pool.swap({
      amountIn: new BN(lamportsIn.toString()),
      minimumAmountOut: new BN(1), // atomic with create
      swapBaseForQuote: false,     // buy token with SOL
      owner: walletPublicKey,
      pool: poolPubkey,
      referralTokenAccount: referralTokenAccount ?? null,
    });

    const buyIxsWithCU = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(buyPriorityMicroLamports) }),
      ...swapTx.instructions,
    ];
    const buyMsg = new TransactionMessage({
      payerKey: walletPublicKey,
      recentBlockhash: blockhash,
      instructions: buyIxsWithCU,
    }).compileToV0Message();
    const buyTx = new VersionedTransaction(buyMsg);

    // ---------- 3) Phantom signs BOTH ----------
    const [signedCreate, signedBuy] = await Promise.all([
      signTransaction(createTx),
      signTransaction(buyTx),
    ]);

    // ---------- 4) sendBundle via our tiny proxy ----------
    const bundleBase58 = [signedCreate, signedBuy].map((tx) => bs58.encode(tx.serialize()));
    const r = await fetch("/api/dbc/send-bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base58Bundle: bundleBase58 }),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || !json || !json.ok) {
      const errMsg =
        (json && (json.error || json.providerResponse?.error?.message)) ||
        `Bundle forward failed (status ${r.status})`;
      throw new Error(errMsg);
    }

    return json as { ok: true; bundleId: string };
  }, []);
}
