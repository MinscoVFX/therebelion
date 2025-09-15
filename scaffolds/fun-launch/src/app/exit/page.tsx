'use client';

import { useState, useEffect } from 'react';
declare const window: any;
import { useWallet, useUnifiedWalletContext } from '@jup-ag/wallet-adapter';
import { useDbcPoolDiscovery } from '@/hooks/useDbcPoolDiscovery';
import { useDbcInstantExit, type DbcPoolKeys } from '@/hooks/useDbcInstantExit';
import { toast } from 'sonner';
import { useDbcAutoBatchExit } from '@/hooks/useDbcAutoBatchExit';

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

  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [autoBatchEnabled, setAutoBatchEnabled] = useState<boolean>(false);
  const [prefs, setPrefs] = useState<ExitPreferences>({
    priorityMicros: 250_000,
    slippageBps: 50,
    simulateFirst: true,
    fastMode: false,
  });

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
      <div className="max-w-2xl mx-auto p-8 text-center">
        <h1 className="text-3xl font-bold mb-8">DBC One-Click Exit</h1>
        <p className="text-gray-600 mb-8">Connect your wallet to discover and exit DBC pools</p>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8 flex items-center gap-4">
        <span>DBC One-Click Exit</span>
        <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 border border-purple-200">prototype</span>
      </h1>

      {/* Pool Discovery */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Your DBC Positions</h2>

        {discoveryLoading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p className="mt-2 text-gray-600">Discovering pools...</p>
          </div>
        )}

        {discoveryError && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
            <p className="text-red-800">Discovery error: {discoveryError}</p>
          </div>
        )}

        {!discoveryLoading && pools.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No DBC positions found. Make sure you have LP tokens or NFT positions in your wallet.
          </div>
        )}

        {pools.length > 0 && (
          <div className="space-y-2">
            {pools.map((pool) => (
              <label
                key={pool.id}
                className="flex items-center p-3 border rounded-md hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="radio"
                  name="selectedPool"
                  value={pool.id}
                  checked={selectedPoolId === pool.id}
                  onChange={(e) => setSelectedPoolId((e.target as HTMLInputElement).value)}
                  className="mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{pool.pool.slice(0, 8)}...</span>
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {pool.badge}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">LP Amount: {pool.lpAmount.toString()}</div>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Exit Controls */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Exit Settings</h2>

        <div className="mb-6 p-3 border rounded-md bg-gray-50 flex flex-col gap-2">
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium">Auto Batch Exit (all positions)</span>
            <input
              type="checkbox"
              checked={autoBatchEnabled}
              onChange={(e) => setAutoBatchEnabled((e.target as HTMLInputElement).checked)}
              className="h-4 w-4"
            />
          </label>
          <p className="text-xs text-gray-600 leading-snug">
            When enabled, processes every discovered position sequentially (currently claim-fee mode only).
            Uses same priority + compute settings. Prototype: full liquidity withdrawal legs will attach once
            validated. You can abort mid‑batch; completed transactions remain.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Slippage (bps)</label>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {prefs.fastMode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="mr-2"
            />
            <span className="text-sm">Simulate first (recommended)</span>
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
              className="mr-2"
            />
            <span className="text-sm">
              Fast mode (skip simulation, processed-first confirmation)
            </span>
          </label>
        </div>

        {!autoBatchEnabled && (
          <div className="flex gap-4">
            <button
              onClick={handleExit}
              disabled={!canExit}
              className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {exitState.status === 'idle' ? 'Exit Selected Pool' : exitState.status}
            </button>

            {exitState.status !== 'idle' &&
              exitState.status !== 'success' &&
              exitState.status !== 'error' && (
                <button
                  onClick={abort}
                  className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  Abort
                </button>
              )}

            {(exitState.status === 'success' || exitState.status === 'error') && (
              <button
                onClick={reset}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
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
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {batchState.running ? 'Batch Running...' : 'Run Auto Batch Exit'}
            </button>
            {batchState.running && (
              <button
                onClick={abortBatch}
                className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Abort Batch
              </button>
            )}
          </div>
        )}
      </div>

      {/* Exit Status (Single) */}
      {!autoBatchEnabled && exitState.status !== 'idle' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Exit Status</h2>

          <div className="space-y-3">
            <div className="flex justify-between">
              <span>Status:</span>
              <span
                className={`font-medium ${
                  exitState.status === 'success'
                    ? 'text-green-600'
                    : exitState.status === 'error'
                      ? 'text-red-600'
                      : 'text-blue-600'
                }`}
              >
                {exitState.status}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Attempt:</span>
              <span>{exitState.attempt}</span>
            </div>

            <div className="flex justify-between">
              <span>Current Priority:</span>
              <span>{exitState.currentPriorityMicros.toLocaleString()} μLamports</span>
            </div>

            {exitState.signature && (
              <div className="flex justify-between">
                <span>Signature:</span>
                <a
                  href={`https://explorer.solana.com/tx/${exitState.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-mono text-sm"
                >
                  {exitState.signature.slice(0, 8)}...
                </a>
              </div>
            )}

            {exitState.error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-red-800">{exitState.error}</p>
              </div>
            )}

            {exitState.simulation && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                <p className="text-blue-800 font-medium mb-2">
                  Simulation: {exitState.simulation.logs.length} logs,{' '}
                  {exitState.simulation.unitsConsumed} CU
                </p>
                {exitState.simulation.logs.slice(0, 5).map((log, i) => (
                  <p key={i} className="text-xs text-blue-700 font-mono">
                    {log}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Batch Status */}
      {autoBatchEnabled && (batchState.running || batchState.items.length > 0) && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <span>Batch Exit Status</span>
            {batchState.running && <span className="text-xs text-indigo-600 animate-pulse">processing</span>}
          </h2>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b">
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
                  <tr key={`${it.pool}-${i}`} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-4 font-mono">{it.pool.slice(0, 6)}...</td>
                    <td className="py-2 pr-4 text-xs">
                      <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">{it.mode}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded border ${
                          it.status === 'confirmed'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : it.status === 'error'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
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
                          className="text-blue-600 hover:underline"
                        >
                          {it.signature.slice(0, 8)}...
                        </a>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs max-w-xs truncate" title={it.error}>{it.error?.slice(0, 64)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {batchState.finishedAt && (
            <p className="mt-4 text-xs text-gray-500">Completed in {((batchState.finishedAt - (batchState.startedAt || batchState.finishedAt)) / 1000).toFixed(1)}s</p>
          )}
          <p className="mt-4 text-xs text-gray-500">Prototype: currently claim-fee only – full withdrawal cycle forthcoming once official exit instruction confirmed.</p>
        </div>
      )}
    </div>
  );
}
