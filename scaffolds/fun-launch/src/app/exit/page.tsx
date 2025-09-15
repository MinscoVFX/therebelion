'use client';

import { useState, useEffect } from 'react';
declare const window: any;
import { useWallet, useUnifiedWalletContext } from '@jup-ag/wallet-adapter';
import { useDbcPoolDiscovery } from '@/hooks/useDbcPoolDiscovery';
import { useDbcInstantExit, type DbcPoolKeys } from '@/hooks/useDbcInstantExit';
import { toast } from 'sonner';

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

  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
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
      <h1 className="text-3xl font-bold mb-8">DBC One-Click Exit</h1>

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
      </div>

      {/* Exit Status */}
      {exitState.status !== 'idle' && (
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
    </div>
  );
}
