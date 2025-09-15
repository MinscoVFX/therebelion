import { useState, useCallback } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { VersionedTransaction, Connection } from '@solana/web3.js';

export interface ExitAllItemResult {
  position: string;
  pool: string;
  status: string; // built | skipped
  reason?: string;
  signature?: string;
}

interface RunArgs {
  migratedOnly?: boolean;
  priorityMicros?: number;
  simulateFirst?: boolean;
}

interface State {
  running: boolean;
  simulate: boolean;
  items: ExitAllItemResult[];
  error?: string;
  txCount: number;
  sent: number;
  confirmed: number;
  aborted: boolean;
}

export function useDammV2ExitAll() {
  const { publicKey, wallet } = useWallet();
  const [state, setState] = useState<State>({
    running: false,
    simulate: false,
    items: [],
    txCount: 0,
    sent: 0,
    confirmed: 0,
    aborted: false,
  });
  const [abortFlag, setAbortFlag] = useState(false);

  const abort = useCallback(() => setAbortFlag(true), []);

  const run = useCallback(async (args: RunArgs) => {
    if (!publicKey || !wallet) return;
    setAbortFlag(false);
    setState((s) => ({ ...s, running: true, aborted: false, error: undefined, items: [], sent: 0, confirmed: 0 }));
    try {
      const res = await fetch('/api/dammv2-exit-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner: publicKey.toBase58(),
          migratedOnly: args.migratedOnly ?? false,
          priorityMicros: args.priorityMicros ?? 250_000,
          simulateOnly: args.simulateFirst ?? false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'exit-all failed');
      const { txs, positions, lastValidBlockHeight } = json;
      setState((s) => ({ ...s, items: positions, txCount: txs.length, simulate: !!args.simulateFirst }));
      if (args.simulateFirst) return; // don't send

      // Adaptive signing: try signAllTransactions first.
      const encodedTxs: string[] = txs || [];
      if (!encodedTxs.length) {
        setState((s) => ({ ...s, running: false }));
        return;
      }
      const versioned = encodedTxs.map((b64) => VersionedTransaction.deserialize(Buffer.from(b64, 'base64')));
      // signAll if available
      let signed: any[] = [];
      const adapter: any = wallet.adapter;
      try {
        if (adapter.signAllTransactions) {
          signed = await adapter.signAllTransactions(versioned);
        } else {
          for (const tx of versioned) {
            signed.push(await adapter.signTransaction(tx));
          }
        }
      } catch (e: any) {
        throw new Error(`signing failed: ${e?.message || e}`);
      }

      let conn: Connection = (window as any)._solanaWeb3ConnectionOverride;
      if (!conn) {
        const endpoint = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
        conn = new Connection(endpoint, 'confirmed');
        (window as any)._solanaWeb3ConnectionOverride = conn;
      }

      let sent = 0;
      let confirmed = 0;
      for (let i = 0; i < signed.length; i++) {
        if (abortFlag) {
          setState((s) => ({ ...s, aborted: true }));
          break;
        }
        const tx = signed[i];
        try {
          const sig = await conn.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
          sent++;
          setState((s) => ({ ...s, sent }));
          // confirm quickly; rely on lastValidBlockHeight implicitly (already compiled)
          await conn.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight });
          confirmed++;
          setState((s) => ({ ...s, confirmed }));
          setState((s) => ({
            ...s,
            items: s.items.map((p, idx) => (idx === i ? { ...p, status: 'confirmed', signature: sig } : p)),
          }));
        } catch (e: any) {
          setState((s) => ({
            ...s,
            items: s.items.map((p, idx) => (idx === i ? { ...p, status: 'error', reason: e?.message || 'send-error' } : p)),
          }));
        }
      }
      setState((s) => ({ ...s, running: false }));
    } catch (e: any) {
      setState((s) => ({ ...s, running: false, error: e?.message || 'unknown error' }));
    }
  }, [publicKey, wallet, abortFlag]);

  return { state, run, abort };
}
