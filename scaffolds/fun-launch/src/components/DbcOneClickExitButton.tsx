'use client';

import React, { useCallback, useState, useEffect } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { useDbcInstantExit } from '@/hooks/useDbcInstantExit';
import { DbcPoolSelector } from '@/components/DbcPoolSelector';
import { useDbcPools } from '@/context/DbcPoolContext';
import { scanDbcPositionsUltraSafe } from '@/server/dbc-adapter';
// useConnection already imported above

type Props = {
  priorityMicros?: number;
  className?: string;
  label?: string;
};

function solscanUrl(sig: string, endpoint: string) {
  const lower = endpoint?.toLowerCase?.() ?? '';
  if (lower.includes('devnet')) return `https://solscan.io/tx/${sig}?cluster=devnet`;
  if (lower.includes('testnet')) return `https://solscan.io/tx/${sig}?cluster=testnet`;
  return `https://solscan.io/tx/${sig}`;
}

export default function DbcOneClickExitButton({
  priorityMicros = 250_000,
  className = 'px-4 py-2 rounded-2xl bg-black text-white hover:opacity-90 disabled:opacity-50',
  label = 'One-Click Exit (DBC)',
}: Props) {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const { state, exit } = useDbcInstantExit();
  const { selected } = useDbcPools();
  const [batchState, setBatchState] = useState<{
    running: boolean;
    total: number;
    done: number;
    lastSig?: string;
    errors: number;
  }>({ running: false, total: 0, done: 0, errors: 0 });
  const [priority, setPriority] = useState<number>(priorityMicros);
  // In earlier iterations we considered optional DAMM exit inclusion; not implemented currently
  // const [includeDamm, setIncludeDamm] = useState(false);
  const [slippageBps, setSlippageBps] = useState(50); // 0.50%
  const [simulateFirst, setSimulateFirst] = useState(true);
  const [fastMode, setFastMode] = useState(false);
  const [computeUnitLimit, setComputeUnitLimit] = useState<number | undefined>();

  // Persist minimal prefs separate from exit page (avoid collision) but reuse key naming style
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dbc-exit-btn-prefs');
      if (saved) {
        const j = JSON.parse(saved);
        if (typeof j.priority === 'number') setPriority(j.priority);
        if (typeof j.slippageBps === 'number') setSlippageBps(j.slippageBps);
        if (typeof j.simulateFirst === 'boolean') setSimulateFirst(j.simulateFirst);
        if (typeof j.fastMode === 'boolean') setFastMode(j.fastMode);
        if (typeof j.computeUnitLimit === 'number') setComputeUnitLimit(j.computeUnitLimit);
      }
    } catch (err) {
      if (process?.env?.NODE_ENV === 'development') console.debug('Load btn prefs failed', err);
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        'dbc-exit-btn-prefs',
        JSON.stringify({ priority, slippageBps, simulateFirst, fastMode, computeUnitLimit })
      );
    } catch (err) {
      if (process?.env?.NODE_ENV === 'development') console.debug('Persist btn prefs failed', err);
    }
  }, [priority, slippageBps, simulateFirst, fastMode, computeUnitLimit]);

  const onClick = useCallback(async (): Promise<void> => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
    if (!selected) {
      toast.error('Select a pool first');
      return;
    }
    if (selected === 'ALL') {
      try {
        setBatchState({ running: true, total: 0, done: 0, errors: 0 });
        const positions = await scanDbcPositionsUltraSafe({ connection, wallet: publicKey });
        if (!positions.length) {
          toast.info('No DBC positions found');
          setBatchState({ running: false, total: 0, done: 0, errors: 0 });
          return;
        }
        // group by pool
        const grouped = new Map<string, typeof positions>();
        positions.forEach((p) => {
          const k = p.poolKeys.pool.toBase58();
          const existing = grouped.get(k);
          if (existing) existing.push(p);
          else grouped.set(k, [p]);
        });
        const pools = Array.from(grouped.entries());
        setBatchState({ running: true, total: pools.length, done: 0, errors: 0 });
        for (const [, poss] of pools) {
          const target = poss?.[0];
          if (!target) {
            setBatchState((s) => ({ ...s, done: s.done + 1, errors: s.errors + 1 }));
            continue;
          }
          try {
            const sig = await exit({
              dbcPoolKeys: {
                pool: target.poolKeys.pool.toBase58(),
                feeVault: target.poolKeys.feeVault.toBase58(),
              },
              priorityMicros: priority,
              simulateFirst: fastMode ? false : simulateFirst,
              slippageBps,
              fastMode,
              computeUnitLimit,
            });
            setBatchState((s) => ({
              ...s,
              done: s.done + 1,
              lastSig: typeof sig === 'string' ? sig : s.lastSig,
            }));
          } catch {
            // Swallow individual pool exit errors but increment error counter
            setBatchState((s) => ({ ...s, done: s.done + 1, errors: s.errors + 1 }));
          }
        }
        toast.success('Batch exit complete');
        setBatchState((s) => ({ ...s, running: false }));
      } catch (error: any) {
        // Already surfaced toast here; add debug for clarity (hidden in production)
        toast.error(error?.message || 'Batch exit failed');
        if (process?.env?.NODE_ENV === 'development') console.debug('Batch exit failed', error);
        setBatchState((s) => ({ ...s, running: false }));
      }
      return;
    }
    await exit({
      dbcPoolKeys: { pool: selected.pool, feeVault: selected.feeVault },
      priorityMicros: priority,
      simulateFirst: fastMode ? false : simulateFirst,
      slippageBps,
      fastMode,
      computeUnitLimit,
    });
  }, [
    connected,
    publicKey,
    exit,
    priority,
    selected,
    connection,
    simulateFirst,
    slippageBps,
    fastMode,
    computeUnitLimit,
  ]);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2">
        <div className="flex gap-3 flex-wrap items-end">
          <DbcPoolSelector />
          <label className="text-xs font-medium flex flex-col">
            Priority (micros)
            <input
              type="number"
              className="border rounded px-2 py-1 text-sm"
              value={priority}
              min={0}
              step={50_000}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </label>
          <label className="text-xs font-medium flex flex-col">
            Slippage (bps)
            <input
              type="number"
              className="border rounded px-2 py-1 text-sm w-24"
              value={slippageBps}
              min={1}
              max={10_000}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
            />
          </label>
          {/* Future option: Include DAMM Exit (disabled pending implementation) */}
          <label className="flex items-center gap-2 text-xs font-medium select-none">
            <input
              type="checkbox"
              checked={simulateFirst && !fastMode}
              disabled={fastMode}
              onChange={(e) => setSimulateFirst(e.target.checked)}
            />
            Simulate First{fastMode && <span className="text-orange-500">(fast)</span>}
          </label>
          <label className="flex items-center gap-2 text-xs font-medium select-none">
            <input
              type="checkbox"
              checked={fastMode}
              onChange={(e) => setFastMode(e.target.checked)}
            />
            Fast Mode
          </label>
          <label className="text-xs font-medium flex flex-col w-28">
            CU Limit (opt)
            <input
              type="number"
              className="border rounded px-2 py-1 text-sm"
              min={50_000}
              max={1_400_000}
              placeholder="auto"
              value={computeUnitLimit ?? ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!e.target.value) return setComputeUnitLimit(undefined);
                if (Number.isFinite(v))
                  setComputeUnitLimit(Math.min(1_400_000, Math.max(50_000, v)));
              }}
            />
          </label>
          <button
            className={className}
            onClick={onClick}
            disabled={
              batchState.running ||
              state.status === 'building' ||
              state.status === 'signing' ||
              state.status === 'sending' ||
              state.status === 'confirming'
            }
          >
            {batchState.running
              ? `Batch ${batchState.done}/${batchState.total}`
              : state.status !== 'idle' && state.status !== 'error' && state.status !== 'success'
                ? `${state.status}...`
                : selected === 'ALL'
                  ? 'Exit All (DBC)'
                  : label}
          </button>
        </div>
        <div className="text-[11px] text-gray-600 min-h-[1.25rem]">
          {batchState.running && (
            <span>
              Batch exiting pools {batchState.done}/{batchState.total} (errors {batchState.errors})
            </span>
          )}
          {state.status === 'error' && state.error && (
            <span className="text-red-600">Error: {state.error}</span>
          )}
          {state.status === 'success' && state.signature && (
            <a
              className="text-blue-600 underline"
              href={solscanUrl(state.signature, '')}
              target="_blank"
              rel="noreferrer"
            >
              View success tx
            </a>
          )}
          {['building', 'signing', 'sending', 'confirming'].includes(state.status) && (
            <span>
              Attempt {state.attempt} – {state.status}
            </span>
          )}
          {state.timings && (
            <span className="ml-2 text-gray-500">
              {(() => {
                const t = state.timings;
                const diff = (a?: number, b?: number) => (a && b ? (b - a).toFixed(0) + 'ms' : '-');
                const total = t.confirmed ? (t.confirmed - t.started).toFixed(0) + 'ms' : '-';
                return `Build ${diff(t.started, t.built)} | Sign ${diff(t.built, t.signed)} | Send ${diff(t.signed, t.sent)} | Proc ${t.processed && t.sent ? (t.processed - t.sent).toFixed(0) + 'ms' : '-'} | Conf ${t.confirmed ? (t.confirmed - (t.processed || t.sent || t.started)).toFixed(0) + 'ms' : '-'} | Total ${total}`;
              })()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
