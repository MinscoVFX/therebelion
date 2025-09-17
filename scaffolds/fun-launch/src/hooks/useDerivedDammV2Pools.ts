"use client";

import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { resolveRpc } from '../lib/rpc';

export interface DerivedDammPosition {
  pool: string;
  position: string;
  liquidity?: string;
}

export function useDerivedDammV2Pools() {
  const { publicKey } = useWallet();
  const { connection: injectedConn } = useConnection();
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<DerivedDammPosition[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!publicKey) {
        setPositions([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const conn = injectedConn || new (await import('@solana/web3.js')).Connection(resolveRpc(), 'confirmed');
        const cp = new CpAmm(conn as any);
        const helper: any = (cp as any).getAllPositionNftAccountByOwner || (cp as any).getAllUserPositionNftAccount;
        if (!helper) {
          setPositions([]);
          return;
        }
        const owner = new PublicKey(publicKey);
        const all = await helper({ owner });
        const mapped: DerivedDammPosition[] = (all || [])
          .map((it: any) => {
            const acct = it.account || {};
            return {
              pool: acct.pool?.toBase58?.() || null,
              position: (it.publicKey || acct.publicKey)?.toBase58?.() || null,
              liquidity: acct.liquidity?.toString?.(),
            };
          })
          .filter((x: any) => x.pool && x.position);
        if (!cancelled) setPositions(mapped);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [publicKey, injectedConn]);

  return { loading, positions, error };
}
