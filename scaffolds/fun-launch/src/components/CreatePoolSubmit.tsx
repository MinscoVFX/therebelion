// scaffolds/fun-launch/src/components/CreatePoolSubmit.tsx
'use client';

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAtomicLaunchClientBundle } from '@/components/hooks/useAtomicLaunchClientBundle';

type Props = {
  connection: Connection; // same RPC as app
  poolAddress: string; // DBC virtual pool (NOT mint/config)
  devBuyAmountSol: number; // from your existing input
  // 🔧 feePayer is OPTIONAL here; hook falls back to walletPublicKey if omitted
  buildCreateIxs: () => Promise<{ ixs: TransactionInstruction[]; feePayer?: PublicKey }>;
  createPriorityMicroLamports?: number; // optional
  buyPriorityMicroLamports?: number; // optional
  referralTokenAccount?: PublicKey; // optional
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
    if (!publicKey || !signTransaction) {
      alert('❌ Connect Phantom first');
      throw new Error('Connect Phantom first');
    }

    try {
      const res = await atomicLaunch({
        connection,
        walletPublicKey: publicKey,
        signTransaction,
        buildCreateIxs, // matches hook’s expected type (feePayer?: PublicKey)
        poolAddress,
        devBuyAmountSol,
        createPriorityMicroLamports,
        buyPriorityMicroLamports,
        referralTokenAccount,
      });

      console.log('✅ Bundle sent:', res.bundleId);
      alert(`✅ Bundle sent!\nBundle ID: ${res.bundleId}`);
    } catch (err: any) {
      console.error('❌ Atomic launch error:', err);

      // Try to surface server `where` tag
      const msg = err?.message || String(err);
      let where = '';
      if (err?.where) {
        where = ` [from ${err.where}]`;
      } else {
        try {
          const m = msg.match(/"where"\s*:\s*"([^"]+)"/);
          if (m) where = ` [from ${m[1]}]`;
        } catch {
          /* ignore */
        }
      }

      alert(`❌ Atomic launch failed: ${msg}${where}`);
    }
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
