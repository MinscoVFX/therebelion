'use client';

import React, { useCallback, useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { toast } from 'sonner';

type Props = {
  priorityMicros?: number;
  className?: string;
  label?: string;
};

function solscanTxUrl(sig: string, endpoint: string): string {
  // Add cluster param for devnet/testnet; default to mainnet explorer
  const lower = endpoint.toLowerCase();
  if (lower.includes('devnet')) return `https://solscan.io/tx/${sig}?cluster=devnet`;
  if (lower.includes('testnet')) return `https://solscan.io/tx/${sig}?cluster=testnet`;
  return `https://solscan.io/tx/${sig}`;
}

export default function OneClickExitAutoButton({
  priorityMicros = 250_000,
  className = 'px-4 py-2 rounded-2xl bg-black text-white hover:opacity-90 disabled:opacity-50',
  label = 'One-Click Exit (Auto)',
}: Props): JSX.Element {
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);

  const onClick = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
    if (loading) return; // prevent double-clicks
    setLoading(true);
    try {
      const res = await fetch('/api/exit-auto', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerPubkey: publicKey.toBase58(),
          priorityMicros,
        }),
      });

      const data: { tx?: string; blockhash?: string; error?: string } = await res.json();
      if (!res.ok || !data?.tx) {
        throw new Error(data?.error || 'Failed to build transaction');
      }

      const vtx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));
      const sig = await sendTransaction(vtx, connection);

      toast.success(
        <div>
          <p className="font-medium">Transaction submitted</p>
          <a
            href={solscanTxUrl(sig, connection.rpcEndpoint)}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            View on Solscan
          </a>
        </div>,
        { duration: 5000 }
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(e);
      toast.error(msg || 'Failed');
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, priorityMicros, sendTransaction, connection, loading]);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={className}
      title="Auto-detect your DAMM v2 LP and remove 100%. No inputs needed."
    >
      {loading ? 'Exiting…' : label}
    </button>
  );
}
