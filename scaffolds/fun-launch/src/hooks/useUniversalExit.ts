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
      slippageBps?: number;
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
          slippageBps: opts.slippageBps,
        });
        const items: UniversalExitItem[] = tasks.map((t) => ({ ...t, status: 'pending' }));
        setState((s) => ({ ...s, planning: false, running: true, startedAt: Date.now(), items }));
        // Build initial tx set (1 per item, using the first/lowest priority variant)
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
        const { errors } = await signTransactionsAdaptive(walletLike, deserialized);

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
          // Adaptive priority: attempt send/confirm across prebuilt variants if present
          const variants = (items[i] as any).priorityTxs as
            | Array<{ tx: string; lastValidBlockHeight: number; priorityMicros: number }>
            | undefined;
          let confirmed = false;
          let lastError: string | undefined;
          const attempts =
            variants && variants.length
              ? variants
              : [
                  {
                    tx: items[i].tx,
                    lastValidBlockHeight: items[i].lastValidBlockHeight,
                    priorityMicros: undefined as unknown as number,
                  },
                ];

          for (let a = 0; a < attempts.length; a++) {
            try {
              // Deserialize this attempt’s tx
              const tryTx = VersionedTransaction.deserialize(Buffer.from(attempts[a].tx, 'base64'));
              // Sign single tx with fallback: prefer signAllTransactions when available for isolation benefits
              let signedOne: VersionedTransaction;
              if (typeof walletLike.signAllTransactions === 'function') {
                try {
                  const arr = await walletLike.signAllTransactions([tryTx]);
                  signedOne =
                    Array.isArray(arr) && arr[0] instanceof VersionedTransaction ? arr[0] : tryTx;
                } catch {
                  // fallback to signTransaction
                  signedOne = await (walletLike.signTransaction as any)(tryTx);
                }
              } else {
                signedOne = await (walletLike.signTransaction as any)(tryTx);
              }
              setState((s) => ({
                ...s,
                currentIndex: i,
                items: s.items.map((it, idx) => (idx === i ? { ...it, status: 'signed' } : it)),
              }));
              const sig = await connection.sendRawTransaction(signedOne.serialize(), {
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
                  blockhash: tryTx.message.recentBlockhash!,
                  lastValidBlockHeight: attempts[a].lastValidBlockHeight,
                },
                'confirmed'
              );
              setState((s) => ({
                ...s,
                items: s.items.map((it, idx) => (idx === i ? { ...it, status: 'confirmed' } : it)),
              }));
              confirmed = true;
              break;
            } catch (e: any) {
              lastError = e?.message || 'failed';
              // Try next variant
            }
          }
          if (!confirmed) {
            setState((s) => ({
              ...s,
              items: s.items.map((it, idx) =>
                idx === i ? { ...it, status: 'error', error: lastError || 'failed' } : it
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
