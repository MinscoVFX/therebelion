'use client';

import { useState, useEffect } from 'react';
declare const window: any;
import { useWallet, useUnifiedWalletContext } from '@jup-ag/wallet-adapter';
import { useDbcPoolDiscovery } from '@/hooks/useDbcPoolDiscovery';
import { useDbcInstantExit, type DbcPoolKeys } from '@/hooks/useDbcInstantExit';
import { toast } from 'sonner';
import { useDbcAutoBatchExit } from '@/hooks/useDbcAutoBatchExit';
import { useUniversalExit } from '@/hooks/useUniversalExit';
import { useDammV2ExitAll } from '@/hooks/useDammV2ExitAll';

interface ExitPreferences {
  priorityMicros: number;
  slippageBps: number;
  simulateFirst: boolean;
  fastMode: boolean;
  computeUnitLimit?: number;
}

export default function ExitPage() {
  const { connected } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  const { pools, loading: discoveryLoading, error: discoveryError } = useDbcPoolDiscovery();
  const { state: exitState, exit, abort, reset } = useDbcInstantExit();
  const { state: batchState, run: runBatch, abort: abortBatch } = useDbcAutoBatchExit();
  const { state: universalState, run: runUniversal, abort: abortUniversal } = useUniversalExit();
  const { state: dammv2AllState, run: runDammv2All, abort: abortDammv2All } = useDammV2ExitAll();

  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [autoBatchEnabled, setAutoBatchEnabled] = useState<boolean>(false);
  const [prefs, setPrefs] = useState<ExitPreferences>({
    priorityMicros: 250_000,
    slippageBps: 50,
    simulateFirst: true,
    fastMode: false,
  });
  const [action, setAction] = useState<'claim' | 'withdraw'>('claim');

  // Load preferences from localStorage
  useEffect(() => {
    try {
  if (typeof window === 'undefined') return;
  const saved = window.localStorage.getItem('dbc-exit-prefs');
      if (saved) {
        const parsed = JSON.parse(saved);
        setPrefs((prev) => ({ ...prev, ...parsed }));
      }
      const autoBatch = window.localStorage.getItem('dbc-auto-exit-enabled');
      if (autoBatch === 'true') setAutoBatchEnabled(true);
    } catch (err) {
      console.warn('Failed to load preferences:', err);
    }
  }, []);

  // Save preferences to localStorage
  useEffect(() => {
    try {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('dbc-exit-prefs', JSON.stringify(prefs));
    } catch (err) {
      console.warn('Failed to save preferences:', err);
    }
  }, [prefs]);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem('dbc-auto-exit-enabled', autoBatchEnabled ? 'true' : 'false');
    } catch (err) {
      console.warn('Failed to persist auto batch toggle:', err);
    }
  }, [autoBatchEnabled]);

  const selectedPool = pools.find((p) => p.id === selectedPoolId);
  const canExit = connected && selectedPool && exitState.status === 'idle';

  const handleExit = async () => {
    if (!selectedPool) return;

    try {
      const dbcPoolKeys: DbcPoolKeys = {
        pool: selectedPool.pool,
        feeVault: selectedPool.feeVault,
      };

      const signature = await exit({
        dbcPoolKeys,
        priorityMicros: prefs.priorityMicros,
        slippageBps: prefs.slippageBps,
        simulateFirst: prefs.simulateFirst,
        fastMode: prefs.fastMode,
        computeUnitLimit: prefs.computeUnitLimit,
      });

      if (signature) {
        toast.success(`Exit successful! Signature: ${signature.slice(0, 8)}...`);
      }
    } catch (err) {
      console.error('Exit failed:', err);
      toast.error(`Exit failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center min-h-screen flex flex-col items-center justify-center bg-neutral-900 text-neutral-100">
        <h1 className="text-3xl font-bold mb-6">DBC One-Click Exit</h1>
        <p className="text-neutral-400 mb-8">Connect your wallet to discover and exit DBC pools</p>
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-5 rounded-md shadow focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8 text-neutral-100 bg-neutral-900 min-h-screen" role="main">
      <h1 className="text-3xl font-bold mb-8 flex items-center gap-4 text-neutral-50">
        <span>Universal Exit (DBC + DAMM v2)</span>
        <span className="text-xs px-2 py-1 rounded bg-purple-500/15 text-purple-300 border border-purple-400/30">beta</span>
        <button
          onClick={() => runDammv2All({ migratedOnly: false, priorityMicros: prefs.priorityMicros, simulateFirst: prefs.simulateFirst })}
          disabled={dammv2AllState.running}
          className="ml-auto text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded shadow"
        >
          {dammv2AllState.running ? 'Withdrawing...' : 'Withdraw All DAMM v2'}
        </button>
        <button
          onClick={() => runUniversal({ priorityMicros: prefs.priorityMicros, computeUnitLimit: prefs.computeUnitLimit })}
          disabled={universalState.running || universalState.planning}
          className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded shadow"
        >
          {universalState.planning ? 'Planning...' : universalState.running ? 'Executing...' : 'One-Click Exit All'}
        </button>
      </h1>

      {/* Live region for high-level status changes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {exitState.status !== 'idle' && `Single exit status: ${exitState.status}`}
        {batchState.running && 'Batch exit running'}
  {universalState.running && 'Universal exit executing'}
  {dammv2AllState.running && 'Withdrawing all DAMM v2 positions'}
      </div>

      {/* Pool Discovery */}
      <div className="bg-neutral-850 rounded-lg border border-neutral-700/60 p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-neutral-50">Your DBC Positions</h2>

        {discoveryLoading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mx-auto"></div>
            <p className="mt-2 text-neutral-400">Discovering pools...</p>
          </div>
        )}

        {discoveryError && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-md p-4 mb-4" role="alert">
            <p className="text-red-300">Discovery error: {discoveryError}</p>
          </div>
        )}

        {!discoveryLoading && pools.length === 0 && (
          <div className="text-center py-8 text-neutral-500">
            No DBC positions found. Make sure you have LP tokens or NFT positions in your wallet.
          </div>
        )}

        {pools.length > 0 && (
          <div className="space-y-2">
            {pools.map((pool) => (
              <label
                key={pool.id}
                className="flex items-center p-3 border border-neutral-700 rounded-md hover:bg-neutral-800 cursor-pointer transition-colors"
              >
                <input
                  type="radio"
                  name="selectedPool"
                  value={pool.id}
                  checked={selectedPoolId === pool.id}
                  onChange={(e) => setSelectedPoolId((e.target as HTMLInputElement).value)}
                  className="mr-3 accent-indigo-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-100">{pool.pool.slice(0, 8)}...</span>
                    <span className="text-xs px-2 py-1 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-400/30">
                      {pool.badge}
                    </span>
                  </div>
                  <div className="text-sm text-neutral-400">LP Amount: {pool.lpAmount.toString()}</div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Exit Controls */}
      <div className="bg-neutral-850 rounded-lg border border-neutral-700/60 p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-neutral-50">Exit Settings</h2>

        <div className="mb-6 p-3 border border-neutral-700 rounded-md bg-neutral-800 flex flex-col gap-2">
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-200">Auto Batch Exit (all positions)</span>
            <input
              type="checkbox"
              checked={autoBatchEnabled}
              onChange={(e) => setAutoBatchEnabled((e.target as HTMLInputElement).checked)}
              className="h-4 w-4 accent-indigo-500"
            />
          </label>
          <p className="text-xs text-neutral-400 leading-snug">
            When enabled, processes every discovered position sequentially (currently claim-fee mode only).
            Uses same priority + compute settings. Prototype: full liquidity withdrawal legs will attach once
            validated. You can abort mid‑batch; completed transactions remain.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Action</label>
            <select
              value={action}
              onChange={(e) => setAction((e.target as HTMLSelectElement).value as 'claim' | 'withdraw')}
              className="w-full px-3 py-2 border border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-neutral-800 text-neutral-100"
            >
              <option value="claim">Claim Fees Only</option>
              <option value="withdraw" disabled>Full Withdraw (coming soon)</option>
            </select>
            {action === 'withdraw' && (
              <p className="mt-1 text-xs text-amber-600">Withdraw not yet implemented – awaiting official DBC instruction layout.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Priority Fee (microLamports)
            </label>
            <input
              type="number"
              min="0"
              max="3000000"
              value={prefs.priorityMicros}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  priorityMicros: Number((e.target as HTMLInputElement).value),
                }))
              }
              className="w-full px-3 py-2 border border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-neutral-800 text-neutral-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">Slippage (bps)</label>
            <input
              type="number"
              min="0"
              max="10000"
              value={prefs.slippageBps}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  slippageBps: Number((e.target as HTMLInputElement).value),
                }))
              }
              className="w-full px-3 py-2 border border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-neutral-800 text-neutral-100"
            />
          </div>

          {prefs.fastMode && (
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-2">
                Compute Unit Limit (optional)
              </label>
              <input
                type="number"
                min="50000"
                max="1400000"
                value={prefs.computeUnitLimit || ''}
                onChange={(e) =>
                  setPrefs((prev) => ({
                    ...prev,
                    computeUnitLimit: (e.target as HTMLInputElement).value
                      ? Number((e.target as HTMLInputElement).value)
                      : undefined,
                  }))
                }
                className="w-full px-3 py-2 border border-neutral-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-neutral-800 text-neutral-100"
                placeholder="e.g., 900000"
              />
            </div>
          )}
        </div>

  <div className="space-y-3 mb-6">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={prefs.simulateFirst && !prefs.fastMode}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  simulateFirst: (e.target as HTMLInputElement).checked,
                }))
              }
              disabled={prefs.fastMode}
              className="mr-2 accent-indigo-500"
            />
            <span className="text-sm text-neutral-300">Simulate first (recommended)</span>
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={prefs.fastMode}
              onChange={(e) =>
                setPrefs((prev) => {
                  const checked = (e.target as HTMLInputElement).checked;
                  return {
                    ...prev,
                    fastMode: checked,
                    simulateFirst: checked ? false : prev.simulateFirst,
                  };
                })
              }
              className="mr-2 accent-indigo-500"
            />
            <span className="text-sm text-neutral-300">
              Fast mode (skip simulation, processed-first confirmation)
            </span>
          </label>
        </div>

        {!autoBatchEnabled && (
          <div className="flex gap-4">
            <button
              onClick={handleExit}
              disabled={!canExit}
              className="px-6 py-2 bg-rose-600 text-white rounded-md hover:bg-rose-500 disabled:bg-neutral-700 disabled:cursor-not-allowed shadow"
            >
              {exitState.status === 'idle' ? 'Exit Selected Pool' : exitState.status}
            </button>

            {exitState.status !== 'idle' &&
              exitState.status !== 'success' &&
              exitState.status !== 'error' && (
                <button
                  onClick={abort}
                  className="px-6 py-2 bg-neutral-700 text-neutral-100 rounded-md hover:bg-neutral-600"
                >
                  Abort
                </button>
              )}

            {(exitState.status === 'success' || exitState.status === 'error') && (
              <button
                onClick={reset}
                className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500"
              >
                Reset
              </button>
            )}
          </div>
        )}

        {autoBatchEnabled && (
          <div className="flex gap-4">
            <button
              onClick={() => runBatch({ priorityMicros: prefs.priorityMicros, computeUnitLimit: prefs.computeUnitLimit })}
              disabled={batchState.running}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:bg-neutral-700 disabled:cursor-not-allowed shadow"
            >
              {batchState.running ? 'Batch Running...' : 'Run Auto Batch Exit'}
            </button>
            {batchState.running && (
              <button
                onClick={abortBatch}
                className="px-6 py-2 bg-neutral-700 text-neutral-100 rounded-md hover:bg-neutral-600"
              >
                Abort Batch
              </button>
            )}
          </div>
        )}
      </div>

      {/* Exit Status (Single) */}
      {!autoBatchEnabled && exitState.status !== 'idle' && (
        <div className="bg-neutral-850 rounded-lg border border-neutral-700/60 p-6">
          <h2 className="text-xl font-semibold mb-4 text-neutral-50">Exit Status</h2>

          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-neutral-300">Status:</span>
              <span
                className={`font-medium ${
                  exitState.status === 'success'
                    ? 'text-emerald-400'
                    : exitState.status === 'error'
                      ? 'text-rose-400'
                      : 'text-indigo-400'
                }`}
              >
                {exitState.status}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-neutral-300">Attempt:</span>
              <span className="text-neutral-100">{exitState.attempt}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-neutral-300">Current Priority:</span>
              <span className="text-neutral-100">{exitState.currentPriorityMicros.toLocaleString()} μLamports</span>
            </div>

            {exitState.signature && (
              <div className="flex justify-between">
                <span className="text-neutral-300">Signature:</span>
                <a
                  href={`https://explorer.solana.com/tx/${exitState.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 hover:underline font-mono text-sm"
                >
                  {exitState.signature.slice(0, 8)}...
                </a>
              </div>
            )}

            {exitState.error && (
              <div className="bg-rose-500/10 border border-rose-500/40 rounded-md p-3" role="alert">
                <p className="text-rose-300 text-sm">{exitState.error}</p>
              </div>
            )}

            {exitState.simulation && (
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-md p-3" role="status" aria-live="polite">
                <p className="text-indigo-300 font-medium mb-2">
                  Simulation: {exitState.simulation.logs.length} logs,{' '}
                  {exitState.simulation.unitsConsumed} CU
                </p>
                {exitState.simulation.logs.slice(0, 5).map((log, i) => (
                  <p key={i} className="text-xs text-indigo-400 font-mono">
                    {log}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-4 mt-4">
            <button
              onClick={() => runUniversal({ priorityMicros: prefs.priorityMicros, computeUnitLimit: prefs.computeUnitLimit })}
              disabled={universalState.running || universalState.planning || !connected}
              className="bg-indigo-600 disabled:opacity-50 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded shadow"
            >
              {universalState.planning ? 'Planning...' : universalState.running ? 'Executing...' : 'Universal Exit All'}
            </button>
            {universalState.running && (
              <button
                onClick={abortUniversal}
                className="bg-neutral-700 hover:bg-neutral-600 text-neutral-100 font-medium px-4 py-2 rounded"
              >
                Abort
              </button>
            )}
          </div>
          {universalState.items.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium mb-2 text-neutral-200">Universal Exit Progress</h3>
              <div className="space-y-2 max-h-64 overflow-auto border border-neutral-700 rounded p-2 bg-neutral-800" role="log" aria-live="polite" aria-relevant="additions text">
                {universalState.items.map((it, idx) => (
                  <div key={idx} className="text-xs flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="font-mono text-neutral-300">{it.protocol}</span>
                      {' '}
                      <span className="text-neutral-400">{it.kind}</span>
                      {' '}
                      <span className="text-neutral-500">{(it.pool||'').slice(0,8)}...</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={{
                        pending: 'text-neutral-500',
                        signed: 'text-indigo-400',
                        sent: 'text-amber-400',
                        confirmed: 'text-emerald-400',
                        error: 'text-rose-400',
                        skipped: 'text-neutral-600'
                      }[it.status]}>{it.status}</span>
                      {it.signature && (
                        <a href={`https://solscan.io/tx/${it.signature}`} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">
                          {it.signature.slice(0,6)}...
                        </a>
                      )}
                      {it.error && <span className="text-rose-400" title={it.error}>err</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* DAMM v2 Withdraw All Status */}
      {dammv2AllState.running || dammv2AllState.items.length > 0 ? (
        <div className="bg-neutral-850 rounded-lg border border-neutral-700/60 p-6 mt-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xl font-semibold text-neutral-50">DAMM v2 Full Withdrawal</h2>
            {dammv2AllState.running && <span className="text-xs text-emerald-400 animate-pulse">processing</span>}
            {dammv2AllState.running && (
              <button
                onClick={abortDammv2All}
                className="ml-auto text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-100 px-3 py-1 rounded"
              >
                Abort
              </button>
            )}
          </div>
          {dammv2AllState.error && (
            <div className="bg-rose-500/10 border border-rose-500/40 rounded p-3 mb-4 text-rose-300 text-sm" role="alert">
              {dammv2AllState.error}
            </div>
          )}
          <div className="space-y-2 max-h-72 overflow-auto border border-neutral-700 rounded p-2 bg-neutral-800" role="log" aria-live="polite">
            {dammv2AllState.items.map((p, i) => (
              <div key={p.position + i} className="text-xs flex items-center justify-between gap-2">
                <div className="truncate">
                  <span className="font-mono text-neutral-300">{p.pool.slice(0,8)}...</span>{' '}
                  <span className="text-neutral-500">{p.position.slice(0,8)}...</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={{
                    built: 'text-indigo-400',
                    confirmed: 'text-emerald-400',
                    skipped: 'text-neutral-600',
                    error: 'text-rose-400'
                  }[p.status] || 'text-neutral-500'}>{p.status}</span>
                  {p.signature && (
                    <a
                      href={`https://explorer.solana.com/tx/${p.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 underline"
                    >
                      {p.signature.slice(0,6)}...
                    </a>
                  )}
                  {p.reason && p.status !== 'confirmed' && (
                    <span className="text-neutral-500" title={p.reason}>?</span>
                  )}
                </div>
              </div>
            ))}
            {dammv2AllState.items.length === 0 && (
              <p className="text-neutral-500 text-xs">No positions discovered or all skipped.</p>
            )}
          </div>
          <p className="mt-3 text-xs text-neutral-500">One-click withdraw builds one tx per position for reliability. Future optimization: packing multiple positions per tx when safe.</p>
        </div>
      ) : null}

      {/* Batch Status */}
      {autoBatchEnabled && (batchState.running || batchState.items.length > 0) && (
        <div className="bg-neutral-850 rounded-lg border border-neutral-700/60 p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-neutral-50">
            <span>Batch Exit Status</span>
            {batchState.running && <span className="text-xs text-indigo-400 animate-pulse">processing</span>}
          </h2>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm text-neutral-200" role="table">
              <thead>
                <tr className="text-left text-neutral-400 border-b border-neutral-700" role="row">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Pool</th>
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Signature</th>
                  <th className="py-2 pr-4">Error</th>
                </tr>
              </thead>
              <tbody>
                {batchState.items.map((it, i) => (
                  <tr key={`${it.pool}-${i}`} className="border-b border-neutral-700 last:border-b-0" role="row">
                    <td className="py-2 pr-4 text-neutral-500">{i + 1}</td>
                    <td className="py-2 pr-4 font-mono text-neutral-300">{it.pool.slice(0, 6)}...</td>
                    <td className="py-2 pr-4 text-xs">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-400/30">{it.mode}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded border ${
                          it.status === 'confirmed'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/40'
                            : it.status === 'error'
                              ? 'bg-rose-500/10 text-rose-300 border-rose-400/40'
                              : 'bg-indigo-500/10 text-indigo-300 border-indigo-400/40'
                        }`}
                      >
                        {it.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {it.signature && (
                        <a
                          href={`https://explorer.solana.com/tx/${it.signature}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 hover:underline"
                        >
                          {it.signature.slice(0, 8)}...
                        </a>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs max-w-xs truncate text-neutral-400" title={it.error}>{it.error?.slice(0, 64)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batchState.finishedAt && (
            <p className="mt-4 text-xs text-neutral-500">Completed in {((batchState.finishedAt - (batchState.startedAt || batchState.finishedAt)) / 1000).toFixed(1)}s</p>
          )}
          <p className="mt-4 text-xs text-neutral-500">Prototype: currently claim-fee only – full withdrawal cycle forthcoming once official exit instruction confirmed.</p>
        </div>
      )}
    </div>
  );
}
