import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction, Transaction } from '@solana/web3.js';
import { toast } from 'sonner';

function notify(type: 'success' | 'error' | 'info', msg: string) {
  if (type === 'error') toast.error(msg);
  else if (type === 'success') toast.success(msg);
  else toast.message(msg);
}

export interface UseDbcInstantExitOptions {
  priorityMicros?: number; // initial microLamports per CU (will escalate on retries)
  includeDammV2Exit?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  dammV2PoolKeys?: any; // typed where imported
  dbcPoolKeys: { pool: string; feeVault: string };
  positionPubkey?: string;
  lpAmount?: string | number;
  lpPercent?: number;
  liquidityDelta?: string | number;
  simulateFirst?: boolean; // run a simulation before sending real tx
  slippageBps?: number; // forwarded to API (1-10_000)
  fastMode?: boolean; // skips simulation, skipPreflight send, processed-first confirm
  computeUnitLimit?: number; // optional compute unit limit to request in API
}

export interface ExitExecutionState {
  status: 'idle' | 'building' | 'signing' | 'sending' | 'confirming' | 'success' | 'error';
  error?: string;
  signature?: string;
  attempt: number;
  currentPriorityMicros?: number;
  simulation?: { logs: string[]; unitsConsumed?: number | null } | null;
  timings?: {
    started: number;
    built?: number;
    signed?: number;
    sent?: number;
    processed?: number;
    confirmed?: number;
  };
}

export function useDbcInstantExit() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const [state, setState] = useState<ExitExecutionState>({ status: 'idle', attempt: 0, simulation: null, timings: undefined });
  const abortRef = useRef(false);

  const reset = useCallback(() => {
  setState({ status: 'idle', attempt: 0, simulation: null, currentPriorityMicros: undefined, timings: undefined });
    abortRef.current = false;
  }, []);

  const exit = useCallback(async (opts: UseDbcInstantExitOptions) => {
    if (!publicKey) return notify('error', 'Connect wallet first');
    if (!connection) return notify('error', 'No RPC connection');
    abortRef.current = false;
    const {
      priorityMicros = 250_000,
      includeDammV2Exit = false,
      maxRetries = 4,
      retryDelayMs = 800,
      simulateFirst = false,
      slippageBps,
      fastMode = false,
      computeUnitLimit,
      ...body
    } = opts;

    const basePayload = {
      ownerPubkey: publicKey.toBase58(),
      includeDammV2Exit,
      ...(slippageBps !== undefined ? { slippageBps } : {}),
      ...(computeUnitLimit ? { computeUnitLimit } : {}),
      ...body,
    };

    let currentPriority = priorityMicros;
    let simulated = false;
    const started = performance.now();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (abortRef.current) return;
      setState(s => ({ ...s, status: 'building', attempt, currentPriorityMicros: currentPriority, timings: { ...(s.timings||{}), started } }));
      try {
        // Optional preflight simulation (only on first attempt)
        if (!fastMode && simulateFirst && !simulated) {
          const simPayload = { ...basePayload, priorityMicros: currentPriority, simulateOnly: true };
          const rs = await fetch('/api/dbc-one-click-exit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(simPayload),
          });
          const sj = await rs.json().catch(() => ({}));
          if (!rs.ok) throw new Error(sj.error || 'Simulation HTTP error');
          if (sj.err) throw new Error('Simulation failed: ' + JSON.stringify(sj.err));
          simulated = true;
          notify('info', 'Simulation OK');
          setState(s => ({ ...s, simulation: { logs: sj.logs || [], unitsConsumed: sj.unitsConsumed ?? null } }));
        }

        const payload = { ...basePayload, priorityMicros: currentPriority };
        const r = await fetch('/api/dbc-one-click-exit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `Failed building tx (HTTP ${r.status})`);
        }
  const { tx: base64Tx, blockhash, lastValidBlockHeight } = await r.json();
        if (!base64Tx) throw new Error('API returned no tx');
        const builtAt = performance.now();
        if (abortRef.current) return;
  setState(s => ({ ...s, status: 'signing', currentPriorityMicros: currentPriority, timings: { ...(s.timings||{}), started, built: builtAt } }));
        const raw = Buffer.from(base64Tx, 'base64');
        let vtx: VersionedTransaction | Transaction;
        try {
          vtx = VersionedTransaction.deserialize(raw);
        } catch {
          // fallback legacy
          vtx = Transaction.from(raw);
        }

        if (!signTransaction) throw new Error('Wallet cannot sign transactions directly');
        vtx = await signTransaction(vtx as any);
        const signedAt = performance.now();
        if (abortRef.current) return;
  setState(s => ({ ...s, status: 'sending', currentPriorityMicros: currentPriority, timings: { ...(s.timings||{}), started, built: builtAt, signed: signedAt } }));
    const sig = await sendTransaction(vtx as any, connection, { skipPreflight: fastMode, maxRetries: fastMode ? 0 : 3 });
        const sentAt = performance.now();
        if (abortRef.current) return;
  setState(s => ({ ...s, status: 'confirming', signature: sig, currentPriorityMicros: currentPriority, timings: { ...(s.timings||{}), started, built: builtAt, signed: signedAt, sent: sentAt } }));
    // Fast mode: processed-first then confirmed.
    let processedAt: number | undefined;
    try {
      if (fastMode) {
        const proc = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'processed');
        if (proc.value.err) throw new Error('Transaction error (processed): ' + JSON.stringify(proc.value.err));
        processedAt = performance.now();
  setState(s => ({ ...s, timings: { ...(s.timings||{}), started: s.timings?.started || started, processed: processedAt } }));
      }
    } catch (e) {
      // processed failure will fall through to confirmed attempt
    }
    const conf = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        if (conf.value.err) throw new Error('Transaction error: ' + JSON.stringify(conf.value.err));
        const confirmedAt = performance.now();
        setState(s => ({ ...s, status: 'success', signature: sig, currentPriorityMicros: currentPriority, timings: { ...(s.timings||{}), started, built: builtAt, signed: signedAt, sent: sentAt, processed: processedAt, confirmed: confirmedAt } }));
        notify('success', `Exit success: ${sig}`);
        return sig; // success
      } catch (e: any) {
        if (abortRef.current) return;
        const rawMsg = e?.message || String(e);
        const msg = decodeFriendlyError(rawMsg);
        setState(s => ({ ...s, status: 'error', error: msg, attempt, currentPriorityMicros: currentPriority }));
        notify('error', msg + (attempt < maxRetries ? ' - retrying' : ''));
        if (attempt < maxRetries) {
          // jittered backoff
          const jitter = Math.random() * 0.4 + 0.8; // 0.8 - 1.2
          // Adaptive priority escalation (bounded)
          currentPriority = Math.min(Math.floor(currentPriority * 1.35), 3_000_000);
          await new Promise(res => setTimeout(res, retryDelayMs * attempt * jitter));
          continue;
        }
        throw new Error(msg);
      }
    }
  }, [publicKey, connection, signTransaction, sendTransaction]);

  const abort = useCallback(() => {
    abortRef.current = true;
    setState(s => (s.status === 'success' ? s : { ...s, status: 'error', error: 'Aborted' }));
  }, []);

  // auto-abort on unmount
  useEffect(() => () => { abortRef.current = true; }, []);

  return { state, exit, reset, abort };
}

// Lightweight structured error translator
function decodeFriendlyError(msg: string): string {
  const lowered = msg.toLowerCase();
  if (/blockhash/i.test(msg) && /expired|not found/.test(lowered)) return 'Blockhash expired – network congestion, retried';
  if (/insufficient funds/.test(lowered)) return 'Insufficient SOL for fees';
  if (/0x1770|custom program error: 0x1770/.test(lowered)) return 'Slippage or output below minimum';
  if (/already processed/.test(lowered)) return 'Transaction already processed';
  if (/signature verification failed/.test(lowered)) return 'Signature rejected by network';
  if (/account.*not found/.test(lowered)) return 'Required account missing (ATA or pool)';
  return msg;
}
