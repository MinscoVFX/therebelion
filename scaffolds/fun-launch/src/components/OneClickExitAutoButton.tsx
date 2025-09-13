'use client';

import { useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { toast } from 'sonner';

export default function OneClickExitAutoButton(props: {
  priorityMicros?: number;
  className?: string;
  label?: string;
}) {
  const {
    priorityMicros = 250_000,
    className = 'px-4 py-2 rounded-2xl bg-black text-white hover:opacity-90 disabled:opacity-50',
    label = 'One-Click Exit (Auto)',
  } = props;

  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
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

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to build transaction');

      const vtx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));
      const sig = await sendTransaction(vtx, connection);
      toast.success(`Submitted: ${sig}`, { duration: 4000 });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={onClick} disabled={loading} className={className}
      title="Auto-detect your DAMM v2 LP and remove 100%. No inputs needed.">
      {loading ? 'Exiting…' : label}
    </button>
  );
}
