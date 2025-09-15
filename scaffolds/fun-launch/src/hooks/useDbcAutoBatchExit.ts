import { useState, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';

export interface AutoBatchStatusItem {
  pool: string;
  feeVault: string;
  lpMint?: string;
  mode: 'claim' | 'full';
  status: 'pending' | 'signed' | 'sent' | 'confirmed' | 'error';
  signature?: string;
  error?: string;
}

export interface AutoBatchState {
  running: boolean;
  items: AutoBatchStatusItem[];
  currentIndex: number;
  startedAt?: number;
  finishedAt?: number;
}

interface BuildBatchResponseTx {
  pool: string; feeVault: string; lpMint?: string; mode: 'claim' | 'full'; tx: string; lastValidBlockHeight: number;
}

export function useDbcAutoBatchExit() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [state, setState] = useState<AutoBatchState>({ running: false, items: [], currentIndex: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState(s => ({ ...s, running: false }));
  }, []);

  const run = useCallback(async (opts: { priorityMicros?: number; computeUnitLimit?: number; strategy?: 'auto'; }) => {
    if (!publicKey || !signTransaction) throw new Error('Wallet not connected');
    if (state.running) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setState({ running: true, items: [], currentIndex: 0, startedAt: Date.now() });

    try {
      // Discover positions
      const discoverResp = await fetch('/api/dbc-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: publicKey.toBase58() }),
        signal: controller.signal,
      });
      if (!discoverResp.ok) throw new Error('Discovery failed');
      const discoverJson = await discoverResp.json();
      const positions: any[] = discoverJson.positions || [];

      if (!positions.length) {
        setState(s => ({ ...s, running: false }));
        return;
      }

      // Build a claim tx per position (future: differentiate full vs claim)
      const buildPromises = positions.map(async (p) => {
        const buildResp = await fetch('/api/dbc-exit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: publicKey.toBase58(),
            dbcPoolKeys: { pool: p.pool, feeVault: p.feeVault },
            priorityMicros: opts.priorityMicros,
            computeUnitLimit: opts.computeUnitLimit,
            simulateOnly: false,
          }),
          signal: controller.signal,
        });
        if (!buildResp.ok) throw new Error(`Build failed for pool ${p.pool}`);
        const buildJson = await buildResp.json();
        const tx64 = buildJson.tx as string;
        return { pool: p.pool, feeVault: p.feeVault, lpMint: p.lpMint, mode: 'claim', tx: tx64, lastValidBlockHeight: buildJson.lastValidBlockHeight } as BuildBatchResponseTx;
      });

      const built = await Promise.all(buildPromises);

      setState(s => ({
        ...s,
        items: built.map(b => ({ pool: b.pool, feeVault: b.feeVault, lpMint: b.lpMint, mode: b.mode, status: 'pending' })),
      }));

      for (let i = 0; i < built.length; i++) {
        if (controller.signal.aborted) break;
        const item = built[i];
        try {
          const tx = VersionedTransaction.deserialize(Buffer.from(item.tx, 'base64'));
          const signed = await signTransaction(tx);
          setState(s => ({ ...s, currentIndex: i, items: s.items.map((it, idx) => idx === i ? { ...it, status: 'signed' } : it) }));
          const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 0 });
          setState(s => ({ ...s, items: s.items.map((it, idx) => idx === i ? { ...it, status: 'sent', signature: sig } : it) }));
          await connection.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash!, lastValidBlockHeight: item.lastValidBlockHeight }, 'confirmed');
          setState(s => ({ ...s, items: s.items.map((it, idx) => idx === i ? { ...it, status: 'confirmed' } : it) }));
        } catch (e: any) {
          setState(s => ({ ...s, items: s.items.map((it, idx) => idx === i ? { ...it, status: 'error', error: e?.message || 'failed' } : it) }));
        }
      }
    } finally {
      setState(s => ({ ...s, running: false, finishedAt: Date.now() }));
    }
  }, [publicKey, signTransaction, connection, state.running]);

  return { state, run, abort };
}
