import { useState, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { signTransactionsAdaptive } from './signingUtils';
import { safeJson } from '../lib/http';

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
      const discoverJson = await safeJson<any>(discoverResp, { allowEmptyObject: true });
      const positions: any[] = discoverJson.positions || [];

      if (!positions.length) {
        setState(s => ({ ...s, running: false }));
        return;
      }

      // Build a claim tx per position (future: differentiate withdraw vs claim)
      const buildPromises = positions.map(async (p) => {
        const buildResp = await fetch('/api/dbc-exit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner: publicKey.toBase58(),
            dbcPoolKeys: { pool: p.pool, feeVault: p.feeVault },
            action: 'claim',
            priorityMicros: opts.priorityMicros,
            computeUnitLimit: opts.computeUnitLimit,
            simulateOnly: false,
          }),
          signal: controller.signal,
        });
        if (!buildResp.ok) throw new Error(`Build failed for pool ${p.pool}`);
        const buildJson = await safeJson<any>(buildResp, { allowEmptyObject: false });
        const tx64 = buildJson.tx as string;
        return { pool: p.pool, feeVault: p.feeVault, lpMint: p.lpMint, mode: 'claim', tx: tx64, lastValidBlockHeight: buildJson.lastValidBlockHeight } as BuildBatchResponseTx;
      });

      const built = await Promise.all(buildPromises);

      setState(s => ({
        ...s,
        items: built.map(b => ({ pool: b.pool, feeVault: b.feeVault, lpMint: b.lpMint, mode: b.mode, status: 'pending' })),
      }));

      // Adaptive signing: attempt batch sign first.
      const deserialized: VersionedTransaction[] = built
        .map(b => {
          try {
            return VersionedTransaction.deserialize(Buffer.from(b.tx, 'base64'));
          } catch {
            return undefined;
          }
        })
        .filter((v): v is VersionedTransaction => !!v);

      // If any failed to deserialize we abort early to avoid mismatched indexing.
      if (deserialized.length !== built.length) {
        setState(s => ({
          ...s,
          running: false,
          items: s.items.map(it => ({ ...it, status: 'error', error: 'deserialize failed' })),
          finishedAt: Date.now(),
        }));
        return;
      }

      const walletLike: any = { signTransaction, signAllTransactions: (signTransaction as any)?.signAllTransactions };
      const { signed: signedTxs, errors } = await signTransactionsAdaptive(walletLike, deserialized);

      for (let i = 0; i < built.length; i++) {
        if (controller.signal.aborted) break;
        if (errors[i]) {
          setState(s => ({ ...s, items: s.items.map((it, idx) => idx === i ? { ...it, status: 'error', error: errors[i] || 'sign failed' } : it) }));
          continue;
        }
        try {
          setState(s => ({ ...s, currentIndex: i, items: s.items.map((it, idx) => idx === i ? { ...it, status: 'signed' } : it) }));
          const txToSend = signedTxs[i];
          if (!txToSend) throw new Error('missing signed transaction');
          const sig = await connection.sendRawTransaction(txToSend.serialize(), { skipPreflight: false, maxRetries: 0 });
          setState(s => ({ ...s, items: s.items.map((it, idx) => idx === i ? { ...it, status: 'sent', signature: sig } : it) }));
          const confirmedTx = deserialized[i];
          const builtMeta = built[i];
          if (!confirmedTx || !builtMeta) throw new Error('confirmation data missing');
          await connection.confirmTransaction({ signature: sig, blockhash: confirmedTx.message.recentBlockhash!, lastValidBlockHeight: builtMeta.lastValidBlockHeight }, 'confirmed');
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
