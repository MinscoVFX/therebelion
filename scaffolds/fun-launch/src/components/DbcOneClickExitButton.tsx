'use client';

import { useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { VersionedTransaction } from '@solana/web3.js';
import { toast } from 'sonner';

type DbcPoolKeys = { pool: string; feeVault: string };

type DammV2PoolKeys = {
  programId: string;
  pool: string;
  lpMint: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenAVault: string;
  tokenBVault: string;
  authorityPda: string;
};

export default function DbcOneClickExitButton(props: {
  dbcPoolKeys: DbcPoolKeys;
  // Turn this on ONLY after you migrate DBC → DAMM v2
  includeDammV2Exit?: boolean;
  dammV2PoolKeys?: DammV2PoolKeys;
  priorityMicros?: number;
  className?: string;
  label?: string;
}) {
  const {
    dbcPoolKeys,
    includeDammV2Exit = false,
    dammV2PoolKeys,
    priorityMicros = 250_000,
    className = 'px-4 py-2 rounded-2xl bg-black text-white hover:opacity-90 disabled:opacity-50',
    label = 'One-Click (Claim Fees + Exit)',
  } = props;

  const { publicKey, sendTransaction, connected, connection } = useWallet();
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/dbc-one-click-exit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerPubkey: publicKey.toBase58(),
          dbcPoolKeys,
          includeDammV2Exit,
          dammV2PoolKeys: includeDammV2Exit ? dammV2PoolKeys ?? null : null,
          priorityMicros,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to build transaction');

      const vtx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));

      const sig = await sendTransaction(vtx, connection);
      toast.success(`Submitted: ${sig}`, { duration: 4000 });

      // Optionally poll for confirmation:
      // await connection.confirmTransaction({ signature: sig, blockhash: data.blockhash, lastValidBlockHeight: data.lastValidBlockHeight }, 'confirmed');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={onClick} disabled={loading} className={className}
      title="Claim DBC trading fees (and remove all LP on DAMM v2 if migrated).">
      {loading ? 'Exiting…' : label}
    </button>
  );
}
