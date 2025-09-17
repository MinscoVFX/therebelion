import { useState, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { planUniversalExits, UniversalExitTask } from './universalExitPlanner';
import { signTransactionsAdaptive } from './signingUtils';
import { assertOnlyAllowedUnsignedSigners } from '../lib/txSigners';

export interface UniversalExitItem extends UniversalExitTask {
  status: 'pending' | 'signed' | 'sent' | 'confirmed' | 'error' | 'skipped';
  signature?: string;
  error?: string;
}

export interface UniversalExitState {
  planning: boolean;
  running: boolean;
  items: UniversalExitItem[];
  currentIndex: number;
  startedAt?: number;
  finishedAt?: number;
}

export function useUniversalExit() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [state, setState] = useState<UniversalExitState>({
    planning: false,
    running: false,
    items: [],
    currentIndex: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, running: false }));
  }, []);

  const run = useCallback(
    async (opts: {
      priorityMicros?: number;
      computeUnitLimit?: number;
      include?: { dbc?: boolean; dammv2?: boolean };
    }) => {
      if (!publicKey || !signTransaction) throw new Error('Wallet not connected');
      if (state.running || state.planning) return;
      const owner = publicKey.toBase58();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((s) => ({ ...s, planning: true, running: false, items: [], currentIndex: 0 }));
      try {
        const tasks = await planUniversalExits({
          owner,
          priorityMicros: opts.priorityMicros,
          computeUnitLimit: opts.computeUnitLimit,
          include: opts.include,
        });
        const items: UniversalExitItem[] = tasks.map((t) => ({ ...t, status: 'pending' }));
        setState((s) => ({ ...s, planning: false, running: true, startedAt: Date.now(), items }));
        const deserialized = items.map((it) =>
          VersionedTransaction.deserialize(Buffer.from(it.tx, 'base64'))
        );
        try {
          for (const tx of deserialized) {
            assertOnlyAllowedUnsignedSigners(tx, [publicKey as PublicKey]);
          }
        } catch (e: any) {
          throw new Error('Signer validation failed: ' + (e?.message || e));
        }
        const walletLike: any = {
          signTransaction,
          signAllTransactions: (signTransaction as any)?.signAllTransactions,
        };
        const { signed, errors } = await signTransactionsAdaptive(walletLike, deserialized);

        for (let i = 0; i < items.length; i++) {
          if (controller.signal.aborted) break;
          if (errors[i]) {
            setState((s) => ({
              ...s,
              items: s.items.map((it, idx) =>
                idx === i ? { ...it, status: 'error', error: errors[i] || 'sign failed' } : it
              ),
            }));
            continue;
          }
          try {
            setState((s) => ({
              ...s,
              currentIndex: i,
              items: s.items.map((it, idx) => (idx === i ? { ...it, status: 'signed' } : it)),
            }));
            const sig = await connection.sendRawTransaction(signed[i].serialize(), {
              skipPreflight: false,
              maxRetries: 0,
            });
            setState((s) => ({
              ...s,
              items: s.items.map((it, idx) =>
                idx === i ? { ...it, status: 'sent', signature: sig } : it
              ),
            }));
            await connection.confirmTransaction(
              {
                signature: sig,
                blockhash: deserialized[i].message.recentBlockhash!,
                lastValidBlockHeight: items[i].lastValidBlockHeight,
              },
              'confirmed'
            );
            setState((s) => ({
              ...s,
              items: s.items.map((it, idx) => (idx === i ? { ...it, status: 'confirmed' } : it)),
            }));
          } catch (e: any) {
            setState((s) => ({
              ...s,
              items: s.items.map((it, idx) =>
                idx === i ? { ...it, status: 'error', error: e?.message || 'failed' } : it
              ),
            }));
          }
        }
      } finally {
        setState((s) => ({ ...s, planning: false, running: false, finishedAt: Date.now() }));
      }
    },
    [publicKey, signTransaction, connection, state.running, state.planning]
  );

  return { state, run, abort };
}
