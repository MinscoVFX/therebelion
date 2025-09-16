'use client';

import { useState, useEffect } from 'react';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { useDbcPoolDiscovery } from '../../hooks/useDbcPoolDiscovery';
import { useDbcInstantExit, type DbcPoolKeys } from '../../hooks/useDbcInstantExit';
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
  const { pools, loading, error } = useDbcPoolDiscovery();
  const { state: exitState, exit } = useDbcInstantExit();
  const [prefs, setPrefs] = useState<ExitPreferences>({
    priorityMicros: 750_000,
    slippageBps: 10_000,
    simulateFirst: true,
    fastMode: false,
  });

  // restore prefs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('dbc-exit-prefs');
      if (saved) setPrefs((p) => ({ ...p, ...JSON.parse(saved) }));
    } catch {
      /* ignore */
    }
  }, []);
  // persist prefs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('dbc-exit-prefs', JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  // Auto-select the pool with the largest LP amount (heuristic for "latest/migrated")
  const selectedPool = pools.reduce(
    (acc, p) => (!acc || p.lpAmount > acc.lpAmount ? p : acc),
    undefined as any
  );
  const canExit = connected && selectedPool && exitState.status === 'idle';

  async function handleExit() {
    if (!selectedPool) {
      toast.error('No DBC position detected to exit');
      return;
    }
    try {
      const dbcPoolKeys: DbcPoolKeys = { pool: selectedPool.pool, feeVault: selectedPool.feeVault };
      const sig = await exit({
        dbcPoolKeys,
        action: 'claim_and_withdraw',
        priorityMicros: prefs.priorityMicros,
        slippageBps: prefs.slippageBps,
        simulateFirst: prefs.simulateFirst,
        fastMode: prefs.fastMode,
        computeUnitLimit: prefs.computeUnitLimit,
      });
      if (sig) toast.success(`Exited position: ${sig.slice(0, 8)}...`);
    } catch (e: any) {
      toast.error(`Exit failed: ${e?.message || e}`);
    }
  }

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center min-h-screen flex flex-col items-center justify-center bg-neutral-900 text-neutral-100">
        <h1 className="text-3xl font-bold mb-6">Claim Fees Only</h1>
        <p className="text-neutral-400 mb-8">
          Withdraws are disabled. Connect your wallet to claim protocol / fee rewards where
          supported.
        </p>
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
    <div className="max-w-3xl mx-auto p-8 text-neutral-100 bg-neutral-900 min-h-screen" role="main">
      <h1 className="text-3xl font-bold mb-4 text-neutral-50">One‑Click Exit</h1>
      <div className="mb-4 rounded-md border border-amber-600/40 bg-amber-950/30 p-3 text-amber-300 text-xs">
        <strong>Notice:</strong> Withdraws are temporarily disabled. Claim-only flow is active while
        withdraw logic is audited and finalized.
      </div>
      <p className="text-neutral-400 mb-6 text-sm">
        Automatically claims all fees and withdraws 100% liquidity from your most significant
        detected DBC position in a single transaction.
      </p>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {exitState.status !== 'idle' && `Claim status: ${exitState.status}`}
      </div>
      {loading && <p className="text-sm text-neutral-400 mb-4">Loading positions...</p>}
      {error && <p className="text-sm text-red-400 mb-4">Discovery error: {error}</p>}
      <div className="space-y-2">
        {selectedPool && (
          <div className="p-4 border border-neutral-700 rounded-md bg-neutral-850">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-300">Selected Pool</span>
              <span className="text-neutral-500">Heuristic: largest LP balance</span>
            </div>
            <div className="mt-2 text-xs text-neutral-400">
              Pool: {selectedPool.pool.slice(0, 8)}... FeeVault: {selectedPool.feeVault.slice(0, 8)}
              ... LP: {selectedPool.lpAmount.toString()}
            </div>
          </div>
        )}
        {!selectedPool && !loading && (
          <div className="text-neutral-500 text-sm">No DBC positions detected.</div>
        )}
      </div>
      <div className="mt-8 bg-neutral-850 rounded-lg border border-neutral-700/60 p-6">
        <h2 className="text-lg font-semibold mb-4 text-neutral-50">Exit Parameters</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <label className="block text-neutral-400 mb-1">Priority Fee (μ-lamports/cu)</label>
            <input
              type="number"
              value={prefs.priorityMicros}
              onChange={(e) => setPrefs((p) => ({ ...p, priorityMicros: Number(e.target.value) }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-neutral-100"
            />
          </div>
          <div>
            <label className="block text-neutral-400 mb-1">Slippage (bps)</label>
            <input
              type="number"
              value={prefs.slippageBps}
              onChange={(e) => setPrefs((p) => ({ ...p, slippageBps: Number(e.target.value) }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-neutral-100"
            />
          </div>
          <div className="flex items-center gap-4 pt-6">
            <label className="flex items-center gap-2 text-neutral-300 text-xs">
              <input
                type="checkbox"
                checked={prefs.simulateFirst}
                onChange={(e) => setPrefs((p) => ({ ...p, simulateFirst: e.target.checked }))}
              />
              Simulate First
            </label>
            <label className="flex items-center gap-2 text-neutral-300 text-xs">
              <input
                type="checkbox"
                checked={prefs.fastMode}
                onChange={(e) => setPrefs((p) => ({ ...p, fastMode: e.target.checked }))}
              />
              Fast Mode
            </label>
          </div>
        </div>
        <button
          disabled={!canExit}
          onClick={handleExit}
          className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-medium py-2 rounded shadow"
        >
          {exitState.status === 'building' && 'Building...'}
          {exitState.status === 'signing' && 'Awaiting Signature...'}
          {exitState.status === 'sending' && 'Sending Exit...'}
          {exitState.status === 'confirming' && 'Confirming...'}
          {exitState.status === 'idle' && 'Exit: Claim + Withdraw 100%'}
        </button>
        {exitState.error && <p className="mt-3 text-xs text-red-400">Error: {exitState.error}</p>}
      </div>
    </div>
  );
}
