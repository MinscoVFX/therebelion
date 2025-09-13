'use client';

import React, { useCallback, useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
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

type Props = {
  dbcPoolKeys: DbcPoolKeys;
  includeDammV2Exit?: boolean;
  dammV2PoolKeys?: DammV2PoolKeys;
  priorityMicros?: number;
  className?: string;
  label?: string;
};

export default function DbcOneClickExitButton({
  dbcPoolKeys,
  includeDammV2Exit = false,
  dammV2PoolKeys,
  priorityMicros = 250_000,
  className = 'px-4 py-2 rounded-2xl bg-black text-white hover:opacity-90 disabled:opacity-50',
  label = 'One-Click (Claim Fees + Exit)',
}: Props): JSX.Element {
  const { publicKey, sendTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);

  const onClick = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
    if (loading) return; // prevent double submit
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

      const data: { tx?: string; blockhash?: string; error?: string } = await res.json();
      if (!res.ok || !data?.tx) {
        throw new Error(data?.error || 'Failed to build transaction');
      }

      const vtx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));
      const sig = await sendTransaction(vtx, connection);

      toast.success(`Submitted: ${sig}`, { duration: 4000 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(e);
      toast.error(msg || 'Failed');
    } finally {
      setLoading(false);
    }
  }, [
    connected,
    publicKey,
    loading,
    dbcPoolKeys,
    includeDammV2Exit,
    dammV2PoolKeys,
    priorityMicros,
    sendTransaction,
    connection,
  ]);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={className}
      title="Claim DBC trading fees (and remove all LP on DAMM v2 if migrated)."
    >
      {loading ? 'Exiting…' : label}
    </button>
  );
