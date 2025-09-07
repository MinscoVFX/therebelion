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
  buildCreateIxs: () => Promise<{ ixs: TransactionInstruction[]; feePayer?: PublicKey }>;
};

type AtomicArgs = BuildCreateIxsArgs & {
  connection: Connection;
  walletPublicKey: PublicKey;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  poolAddress: string;           // DBC virtual pool
  devBuyAmountSol: number;
  createPriorityMicroLamports?: number;
  buyPriorityMicroLamports?: number;
  referralTokenAccount?: PublicKey;
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

    // ---------- 1) CREATE (unsigned) ----------
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
    let buyTxV0: VersionedTransaction | null = null;
    try {
      const dbc = new DynamicBondingCurveClient(connection, "confirmed");
      const swapTx = await dbc.pool.swap({
        amountIn: new BN(lamportsIn.toString()),
        minimumAmountOut: new BN(1),
        swapBaseForQuote: false,
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
      if (!/Pool not found/i.test(msg)) {
        throw new Error(msg);
      }

      // ---------- Fallback: server builds swap (stateless) ----------
      const resp = await fetch("/api/build-swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseMint: (baseMint ?? walletPublicKey).toBase58(), // just for validation on server
          payer: walletPublicKey.toBase58(),
          amountSol: String(devBuyAmountSol),
          pool: poolAddress,
          blockhash, // share with create for bundle coherence
        }),
      });

      const j = await resp.json().catch(() => null as any);
      if (!resp.ok || !j?.ok) {
        const where = j?.where ? ` [from ${j.where}]` : "";
        const errMsg = (j && (j.error || j?.providerResponse?.error?.message)) || `build-swap failed (HTTP ${resp.status})`;
        throw new Error(`${errMsg}${where}`);
      }

      const legacy = Transaction.from(Buffer.from(j.swapTx, "base64"));

      // add tip
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

      const buyMsg = new TransactionMessage({
        payerKey: walletPublicKey,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      buyTxV0 = new VersionedTransaction(buyMsg);
    }

    // ---------- 3) Sign both ----------
    const [signedCreate, signedBuy] = await Promise.all([
      signTransaction(createTx),
      signTransaction(buyTxV0!),
    ]);

    // ---------- 4) Send bundle ----------
    const base58Bundle = [signedCreate, signedBuy].map((tx) => bs58.encode(tx.serialize()));
    const r = await fetch("/api/dbc/send-bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base58Bundle }),
    });

    const json = await r.json().catch(() => null as any);
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
