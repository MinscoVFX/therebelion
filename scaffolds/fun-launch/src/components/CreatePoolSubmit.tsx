// scaffolds/fun-launch/src/components/CreatePoolSubmit.tsx
"use client";

import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAtomicLaunchClientBundle } from "@/components/hooks/useAtomicLaunchClientBundle";

type Props = {
  /** Active Solana connection (same RPC as the app) */
  connection: Connection;

  /** DBC *virtual pool* address you show on the form (NOT mint, NOT config) */
  poolAddress: string;

  /** Amount of SOL to dev-buy (from your existing input) */
  devBuyAmountSol: number;

  /** Returns the create-pool instructions (NOT sent or signed). 
   *  Wrap whatever builder you already call today.
   */
  buildCreateIxs: () => Promise<{ ixs: TransactionInstruction[]; feePayer?: PublicKey }>;

  /** Optional priority fees (micro-lamports) */
  createPriorityMicroLamports?: number;
  buyPriorityMicroLamports?: number;

  /** Optional referral ATA */
  referralTokenAccount?: PublicKey;
};

export default function CreatePoolSubmit({
  connection,
  poolAddress,
  devBuyAmountSol,
  buildCreateIxs,
  createPriorityMicroLamports = 100_000,
  buyPriorityMicroLamports = 150_000,
  referralTokenAccount,
}: Props) {
  const { publicKey, signTransaction } = useWallet();
  const atomicLaunch = useAtomicLaunchClientBundle();

  async function onLaunch() {
    if (!publicKey || !signTransaction) throw new Error("Connect Phantom first");
    const res = await atomicLaunch({
      connection,
      walletPublicKey: publicKey,
      signTransaction,
      buildCreateIxs,
      poolAddress,
      devBuyAmountSol,
      createPriorityMicroLamports,
      buyPriorityMicroLamports,
      referralTokenAccount,
    });
    console.log("Bundle sent:", res.bundleId);
  }

  return (
    <button
      onClick={onLaunch}
      className="rounded-xl bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
    >
      Launch + Dev Buy (Atomic)
    </button>
  );
}
