import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
import { useDbcInstantExit } from '@/hooks/useDbcInstantExit';
import { DbcPoolProvider, useDbcPools } from '@/context/DbcPoolContext';
import { DbcPoolSelector } from '@/components/DbcPoolSelector';
import { toast } from 'sonner';

function solscanTxUrl(sig: string, endpoint: string) {
  const lower = endpoint?.toLowerCase?.() || '';
  if (lower.includes('devnet')) return `https://solscan.io/tx/${sig}?cluster=devnet`;
  if (lower.includes('testnet')) return `https://solscan.io/tx/${sig}?cluster=testnet`;
  return `https://solscan.io/tx/${sig}`;
}

function SolscanLink({ sig }: { sig: string }) {
  const { connection } = useConnection();
  return (
    <a
      href={solscanTxUrl(sig, (connection as any)?.rpcEndpoint || '')}
      target="_blank"
      rel="noreferrer"
      className="underline text-xs text-blue-600"
    >
      View
    </a>
  );
}

const SingleExitPanel: React.FC = () => {
  const { publicKey } = useWallet();
  const { selected } = useDbcPools();
  const { state, exit, reset, abort } = useDbcInstantExit();
  const [simulateFirst, setSimulateFirst] = useState(true);
  const [priority, setPriority] = useState(250_000);
  const [slippageBps, setSlippageBps] = useState(50);
  const [fastMode, setFastMode] = useState(false);
  const [computeUnitLimit, setComputeUnitLimit] = useState<number | undefined>(undefined);
  const busyRef = useRef(false);
  const disabled = !publicKey || !selected || state.status === 'building' || state.status === 'sending' || state.status === 'signing' || state.status === 'confirming';

  // Persist preferences
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dbc-exit-prefs');
      if (saved) {
        const j = JSON.parse(saved);
        if (typeof j.priority === 'number') setPriority(j.priority);
        if (typeof j.slippageBps === 'number') setSlippageBps(j.slippageBps);
        if (typeof j.simulateFirst === 'boolean') setSimulateFirst(j.simulateFirst);
        if (typeof j.fastMode === 'boolean') setFastMode(j.fastMode);
        if (typeof j.computeUnitLimit === 'number') setComputeUnitLimit(j.computeUnitLimit);
      }
    } catch (err) {
      if (process?.env?.NODE_ENV === 'development') console.debug('Failed to load exit prefs', err);
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('dbc-exit-prefs', JSON.stringify({ priority, slippageBps, simulateFirst, fastMode, computeUnitLimit })); } catch (err) {
      if (process?.env?.NODE_ENV === 'development') console.debug('Failed to persist exit prefs', err);
    }
  }, [priority, slippageBps, simulateFirst, fastMode, computeUnitLimit]);

  const dbcPoolKeys = useMemo(() => {
    if (!selected || selected === 'ALL') return undefined;
    return { pool: selected.pool, feeVault: selected.feeVault };
  }, [selected]);

  const onExit = useCallback(async (): Promise<void> => {
    if (!dbcPoolKeys) { toast.error('Select a specific pool (not ALL) for single exit'); return; }
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await exit({ dbcPoolKeys, priorityMicros: priority, simulateFirst: fastMode ? false : simulateFirst, slippageBps, fastMode, computeUnitLimit });
    } catch (e) {
      // Error already surfaced through toast/state in hook; keep block to satisfy lint
      if (process?.env?.NODE_ENV === 'development') console.debug('Single exit error (already surfaced)', e);
    } finally { busyRef.current = false; }
  }, [dbcPoolKeys, priority, simulateFirst, slippageBps, exit, fastMode, computeUnitLimit]);

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h2 className="font-semibold">Single Pool Exit</h2>
  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">Priority (µLamports)</label>
          <input
            type="number"
            min={0}
            value={priority}
            onChange={e => setPriority(Number(e.target.value) || 0)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">Slippage (bps)</label>
          <input
            type="number"
            min={1}
            max={10000}
            value={slippageBps}
            onChange={e => setSlippageBps(Math.min(10000, Math.max(1, Number(e.target.value) || 50)))}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600 flex items-center gap-1">Simulate First{fastMode && <span className="text-orange-500">(off in Fast)</span>}</label>
          <input
            type="checkbox"
            checked={simulateFirst && !fastMode}
            disabled={fastMode}
            onChange={e => setSimulateFirst(e.target.checked)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">Fast Mode</label>
          <input
            type="checkbox"
            checked={fastMode}
            onChange={e => setFastMode(e.target.checked)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">CU Limit (opt)</label>
          <input
            type="number"
            className="border rounded px-2 py-1 text-sm"
            min={50_000}
            max={1_400_000}
            placeholder="auto"
            value={computeUnitLimit ?? ''}
            onChange={e => {
              const v = Number(e.target.value);
              if (!e.target.value) return setComputeUnitLimit(undefined);
              if (Number.isFinite(v)) setComputeUnitLimit(Math.min(1_400_000, Math.max(50_000, v)));
            }}
          />
        </div>
        <div className="flex items-end">
          <button
            disabled={disabled || !dbcPoolKeys}
            onClick={onExit}
            className="w-full px-3 py-2 rounded bg-black text-white text-sm disabled:opacity-40"
          >
            {state.status === 'building' || state.status === 'signing' || state.status === 'sending' || state.status === 'confirming'
              ? 'Processing…'
              : 'Exit Selected'}
          </button>
        </div>
      </div>
      <div className="text-xs text-gray-600 space-y-1">
        <div>Status: <span className="font-medium">{state.status}</span>{state.currentPriorityMicros ? ` (priority ${state.currentPriorityMicros})` : ''}</div>
        {state.simulation?.logs && state.simulation.logs.length > 0 && (
          <details className="border rounded p-2 bg-gray-50">
            <summary className="cursor-pointer select-none text-gray-700">Simulation Logs ({state.simulation.logs.length})</summary>
            <pre className="mt-2 max-h-48 overflow-auto text-[10px] leading-snug whitespace-pre-wrap">{state.simulation.logs.join('\n')}</pre>
          </details>
        )}
        {state.timings && (
          <div className="text-[10px] grid grid-cols-3 md:grid-cols-6 gap-1 pt-1">
            {(() => {
              const t = state.timings;
              const fmt = (a?: number, b?: number) => a && b ? (b - a).toFixed(0)+'ms' : '-';
              return [
                ['Build', fmt(t.started, t.built)],
                ['Sign', fmt(t.built, t.signed)],
                ['Send', fmt(t.signed, t.sent)],
                ['Proc', t.processed && t.sent ? (t.processed - t.sent).toFixed(0)+'ms' : '-'],
                ['Conf', t.confirmed && (t.processed || t.sent) ? (t.confirmed - (t.processed ?? t.sent ?? t.started)).toFixed(0)+'ms' : '-'],
                ['Total', t.confirmed ? (t.confirmed - t.started).toFixed(0)+'ms' : '-'],
              ].map(([k,v]) => <div key={k} className="border rounded px-1 py-0.5 bg-gray-50 flex flex-col items-center"><span>{k}</span><span className="font-mono">{v}</span></div>);
            })()}
          </div>
        )}
        {state.signature && (
          <div>Signature: <code>{state.signature.slice(0, 12)}…</code> <SolscanLink sig={state.signature} /></div>
        )}
        {state.error && state.status === 'error' && (
          <div className="text-red-600">Error: {state.error}</div>
        )}
        <div className="flex gap-2">
          {state.status === 'success' && (
            <button className="text-blue-600 underline" onClick={() => reset()}>Reset</button>
          )}
          {['building','signing','sending','confirming'].includes(state.status) && (
            <button className="text-orange-600 underline" onClick={() => abort()}>Abort</button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-gray-500">Adaptive priority escalates automatically on retries. Fast Mode skips simulation & preflight and shows processed timing first; use cautiously. For batch across all pools use the section below.</p>
    </div>
  );
};

const BatchExitPanel: React.FC = () => {
  const { publicKey } = useWallet();
  const { pools, selected } = useDbcPools();
  const { exit, abort } = useDbcInstantExit();
  const [simulateFirst, setSimulateFirst] = useState(true);
  const [priority, setPriority] = useState(250_000);
  const [slippageBps, setSlippageBps] = useState(50);
  const [fastMode, setFastMode] = useState(false);
  const [computeUnitLimit, setComputeUnitLimit] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ pool: string; status: 'pending' | 'success' | 'error'; signature?: string; error?: string }[]>([]);

  const eligiblePools = useMemo(() => (selected === 'ALL' ? pools : []), [selected, pools]);

  const runBatch = useCallback(async (): Promise<void> => {
    if (!publicKey) { toast.error('Connect wallet'); return; }
    if (!eligiblePools.length) { toast.error('Select ALL to batch exit'); return; }
    if (running) return;
    setRunning(true);
    const initial = eligiblePools.map(p => ({ pool: p.pool, status: 'pending' as const }));
    setResults(initial);
    for (let i = 0; i < eligiblePools.length; i++) {
      const p = eligiblePools[i];
      if (!p) continue;
      try {
        const sig = await exit({ dbcPoolKeys: { pool: p.pool, feeVault: p.feeVault }, priorityMicros: priority, simulateFirst: fastMode ? false : simulateFirst, slippageBps, fastMode, computeUnitLimit });
        setResults(r => r.map(item => item.pool === p.pool ? { ...item, status: 'success', signature: sig as string } : item));
      } catch (e: any) {
        setResults(r => r.map(item => item.pool === p.pool ? { ...item, status: 'error', error: e?.message || String(e) } : item));
      }
    }
    setRunning(false);
  }, [publicKey, eligiblePools, exit, priority, simulateFirst, slippageBps, running, fastMode, computeUnitLimit]);

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <h2 className="font-semibold">Batch Exit (ALL)</h2>
  <div className="grid grid-cols-2 md:grid-cols-7 gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">Priority (µLamports)</label>
          <input type="number" value={priority} onChange={e => setPriority(Number(e.target.value)||0)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">Slippage (bps)</label>
          <input type="number" value={slippageBps} min={1} max={10000} onChange={e => setSlippageBps(Math.min(10000, Math.max(1, Number(e.target.value)||50)))} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600 flex items-center gap-1">Simulate First{fastMode && <span className="text-orange-500">(off)</span>}</label>
          <input type="checkbox" checked={simulateFirst && !fastMode} disabled={fastMode} onChange={e => setSimulateFirst(e.target.checked)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">Fast Mode</label>
          <input type="checkbox" checked={fastMode} onChange={e => setFastMode(e.target.checked)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-gray-600">CU Limit (opt)</label>
          <input
            type="number"
            className="border rounded px-2 py-1 text-sm"
            min={50_000}
            max={1_400_000}
            placeholder="auto"
            value={computeUnitLimit ?? ''}
            onChange={e => {
              const v = Number(e.target.value);
              if (!e.target.value) return setComputeUnitLimit(undefined);
              if (Number.isFinite(v)) setComputeUnitLimit(Math.min(1_400_000, Math.max(50_000, v)));
            }}
          />
        </div>
        <div className="flex items-end">
          <button
            disabled={!eligiblePools.length || running}
            onClick={runBatch}
            className="w-full px-3 py-2 rounded bg-black text-white text-sm disabled:opacity-40"
          >
            {running ? 'Batch Running…' : 'Exit ALL'}
          </button>
        </div>
      </div>
      {running && (
        <div className="text-[11px] text-gray-600">Escalating priority per pool as needed. <button className="underline" onClick={()=>{ abort(); setRunning(false); }}>Abort Batch</button></div>
      )}
      {results.length > 0 && (
        <table className="w-full text-xs border mt-2">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="p-1 text-left">Pool</th>
              <th className="p-1 text-left">Status</th>
              <th className="p-1 text-left">Signature / Error</th>
            </tr>
          </thead>
          <tbody>
            {results.map(r => (
              <tr key={r.pool} className="border-t">
                <td className="p-1 font-mono text-[11px]">{r.pool.slice(0,6)}…{r.pool.slice(-4)}</td>
                <td className="p-1">{r.status}</td>
                <td className="p-1">
                  {r.status === 'success' && r.signature && <SolscanLink sig={r.signature} />}
                  {r.status === 'error' && <span className="text-red-600">{r.error}</span>}
                  {r.status === 'pending' && <span className="text-gray-400">pending…</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!eligiblePools.length && <p className="text-[11px] text-gray-500">Select ALL in the pool selector to enable batch mode.</p>}
    </div>
  );
};

const ExitContent: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div className="md:w-72"><DbcPoolSelector /></div>
        <p className="text-xs text-gray-600 max-w-md">Automatically discovers LP + NFT-based migrated pools. Use Single Pool Exit for granular control or Batch Exit for sequential exits across every discovered pool.</p>
      </div>
      <SingleExitPanel />
      <BatchExitPanel />
    </div>
  );
};

export default function ExitPage() {
  return (
    <DbcPoolProvider>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">One-Click Exit</h1>
        <ExitContent />
      </div>
    </DbcPoolProvider>
  );
}
