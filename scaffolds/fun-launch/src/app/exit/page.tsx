'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { toast } from 'sonner';

import { DbcPoolProvider, useDbcPools } from '@/context/DbcPoolContext';
import { TxTable } from '@/components/TokenTable/TxTable';
import { useDbcInstantExit } from '@/hooks/useDbcInstantExit';
import { useDbcAutoBatchExit } from '@/hooks/useDbcAutoBatchExit';
import { useUniversalExit } from '@/hooks/useUniversalExit';
import {
  discoverMigratedDbcPoolsViaMetadata,
  discoverMigratedDbcPoolsViaNfts,
  scanDbcPositionsUltraSafe,
  type DbcPosition,
} from '@/server/dbc-adapter';

interface ExitPreferences {
  priorityMicros: number;
  slippageBps: number;
  simulateFirst: boolean;
  fastMode: boolean;
  computeUnitLimit?: number;
  exitAction: 'claim' | 'withdraw' | 'withdraw_first' | 'claim_and_withdraw';
  autoBatchEnabled: boolean;
  includeDbc: boolean;
  includeDammv2: boolean;
}

const PREFERENCE_STORAGE_KEY = 'dbc-exit-prefs';

// Default payload sent via useDbcInstantExit includes action: 'withdraw_first'
// so withdraw legs are attempted before falling back to claim via /api/dbc-exit.
const DEFAULT_EXIT_ACTION = { action: 'withdraw_first' as const };

const DEFAULT_PREFS: ExitPreferences = {
  priorityMicros: 750_000,
  slippageBps: 100,
  simulateFirst: true,
  fastMode: false,
  computeUnitLimit: 400_000,
  exitAction: DEFAULT_EXIT_ACTION.action,
  autoBatchEnabled: false,
  includeDbc: true,
  includeDammv2: true,
};

interface DebugPosition {
  mint: string;
  tokenAccount: string;
  name?: string;
  symbol?: string;
  updateAuthority?: string;
}

function loadInitialPreferences(): ExitPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const stored = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
    if (!stored) return DEFAULT_PREFS;
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
    } satisfies ExitPreferences;
  } catch (error) {
    console.warn('[exit] failed to parse stored prefs', error);
    return DEFAULT_PREFS;
  }
}

function persistPreferences(prefs: ExitPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn('[exit] failed to persist prefs', error);
  }
}

function solscanUrl(sig: string, endpoint: string) {
  const lower = endpoint?.toLowerCase?.() ?? '';
  if (lower.includes('devnet')) return `https://solscan.io/tx/${sig}?cluster=devnet`;
  if (lower.includes('testnet')) return `https://solscan.io/tx/${sig}?cluster=testnet`;
  return `https://solscan.io/tx/${sig}`;
}

function shortKey(key: string, len = 4) {
  if (!key) return '';
  return `${key.slice(0, len)}…${key.slice(-len)}`;
}

function formatDuration(start?: number, end?: number) {
  if (!start || !end) return '–';
  const diff = Math.max(0, end - start);
  if (diff < 1000) return `${diff} ms`;
  return `${(diff / 1000).toFixed(2)} s`;
}

function formatTimestamp(ts?: number) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

const EXIT_ACTION_OPTIONS: { value: ExitPreferences['exitAction']; label: string; description: string }[] = [
  {
    value: 'withdraw_first',
    label: 'Prefer Withdraw (fallback to Claim)',
    description:
      'Attempts a full withdraw first and automatically falls back to claim-only if withdraw is unsupported.',
  },
  {
    value: 'claim',
    label: 'Claim Trading Fees Only',
    description: 'Safest path when withdraw discriminators are not configured.',
  },
  {
    value: 'withdraw',
    label: 'Withdraw Only',
    description: 'Builds the withdraw leg directly. Requires production discriminator + accounts.',
  },
  {
    value: 'claim_and_withdraw',
    label: 'Claim + Withdraw (single tx)',
    description: 'Combines fee claim and withdraw in one transaction. Requires full configuration.',
  },
];

export default function ExitPage() {
  return (
    <DbcPoolProvider>
      <ExitPageInner />
    </DbcPoolProvider>
  );
}

function ExitPageInner() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  const { connection } = useConnection();
  const { pools, selected, setSelectedId, loading: poolLoading, error: poolError } = useDbcPools();

  const { state: exitState, exit, abort, reset } = useDbcInstantExit();
  const { state: batchState, run: runBatch, abort: abortBatch } = useDbcAutoBatchExit();
  const { state: universalState, run: runUniversal, abort: abortUniversal } = useUniversalExit();

  const [prefs, setPrefs] = useState<ExitPreferences>(() => loadInitialPreferences());
  useEffect(() => {
    persistPreferences(prefs);
  }, [prefs]);

  const [positions, setPositions] = useState<DbcPosition[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);

  const [debugMode, setDebugMode] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugPositions, setDebugPositions] = useState<DebugPosition[]>([]);

  const [autoDiscoverLoading, setAutoDiscoverLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setDebugMode(params.get('debug') === '1');
  }, []);

  const refreshPositions = useCallback(async () => {
    if (!publicKey) {
      setPositions([]);
      setPosError(null);
      return;
    }
    setPosLoading(true);
    setPosError(null);
    try {
      const found = await scanDbcPositionsUltraSafe({ connection, wallet: publicKey });
      setPositions(found);
      if (!found.length) {
        const [nftPools, metaPools] = await Promise.all([
          discoverMigratedDbcPoolsViaNfts({ connection, wallet: publicKey }),
          discoverMigratedDbcPoolsViaMetadata({ connection, wallet: publicKey }),
        ]);
        if (nftPools.length || metaPools.length) {
          console.info(
            '[exit] No LP positions but NFT heuristics returned candidates:',
            nftPools.length,
            metaPools.length,
          );
        }
      }
    } catch (error) {
      console.error('[exit] position refresh failed', error);
      setPosError(error instanceof Error ? error.message : String(error));
    } finally {
      setPosLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    refreshPositions();
  }, [refreshPositions]);

  useEffect(() => {
    if (!debugMode || !publicKey) return;
    let cancelled = false;
    setDebugLoading(true);
    fetch(`/api/dbc-discover?wallet=${publicKey.toBase58()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => {
        if (cancelled) return;
        setDebugPositions(Array.isArray(json?.positions) ? json.positions : []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[exit] debug fetch failed', error);
        setDebugPositions([]);
      })
      .finally(() => {
        if (cancelled) return;
        setDebugLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debugMode, publicKey]);

  const largestPosition = useMemo(() => {
    if (!positions.length) return undefined;
    return positions.reduce<DbcPosition | undefined>((acc, pos) => {
      if (!acc) return pos;
      return pos.lpAmount > acc.lpAmount ? pos : acc;
    }, undefined);
  }, [positions]);

  const targetPool = useMemo(() => {
    if (selected === 'ALL' || !selected) {
      if (!largestPosition) return null;
      return {
        pool: largestPosition.poolKeys.pool.toBase58(),
        feeVault: largestPosition.poolKeys.feeVault.toBase58(),
        label: `Largest detected pool ${shortKey(largestPosition.poolKeys.pool.toBase58())}`,
      };
    }
    return {
      pool: selected.pool,
      feeVault: selected.feeVault,
      label: selected.label,
    };
  }, [largestPosition, selected]);

  const isExitActive = exitState.status !== 'idle' && exitState.status !== 'error' && exitState.status !== 'success';

  const handleExitSelected = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      setShowModal(true);
      return;
    }
    if (!targetPool) {
      toast.error('No eligible pool found. Refresh your positions.');
      return;
    }
    try {
      const action = prefs.exitAction ?? DEFAULT_EXIT_ACTION.action;
      const signature = await exit({
        dbcPoolKeys: { pool: targetPool.pool, feeVault: targetPool.feeVault },
        action,
        priorityMicros: prefs.priorityMicros,
        slippageBps: prefs.slippageBps,
        simulateFirst: prefs.fastMode ? false : prefs.simulateFirst,
        fastMode: prefs.fastMode,
        computeUnitLimit: prefs.computeUnitLimit,
      });
      if (typeof signature === 'string') {
        toast.success(
          <div>
            <p className="font-medium">Transaction submitted</p>
            <a
              className="underline"
              href={solscanUrl(signature, (connection as any).rpcEndpoint)}
              target="_blank"
              rel="noreferrer"
            >
              View on Solscan
            </a>
          </div>,
          { duration: 8000 },
        );
        refreshPositions();
      }
    } catch (error) {
      console.error('[exit] instant exit failed', error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    }
  }, [
    connected,
    publicKey,
    targetPool,
    exit,
    prefs.exitAction,
    prefs.priorityMicros,
    prefs.slippageBps,
    prefs.simulateFirst,
    prefs.fastMode,
    prefs.computeUnitLimit,
    connection,
    refreshPositions,
    setShowModal,
  ]);

  const handleAutoOneClickExit = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      setShowModal(true);
      return;
    }
    if (autoDiscoverLoading) return;
    setAutoDiscoverLoading(true);
    try {
      const response = await fetch('/api/dbc-one-click-exit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerPubkey: publicKey.toBase58(),
          priorityMicros: prefs.priorityMicros,
          computeUnitLimit: prefs.computeUnitLimit,
          slippageBps: prefs.slippageBps,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.tx) {
        throw new Error(data?.error || 'Failed to build one-click exit transaction');
      }
      const tx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));
      const sig = await sendTransaction(tx, connection);
      toast.success(
        <div>
          <p className="font-medium">One-click exit submitted</p>
          <a
            className="underline"
            href={solscanUrl(sig, (connection as any).rpcEndpoint)}
            target="_blank"
            rel="noreferrer"
          >
            View on Solscan
          </a>
        </div>,
        { duration: 8000 },
      );
      refreshPositions();
    } catch (error) {
      console.error('[exit] auto discover exit failed', error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || 'One-click exit failed');
    } finally {
      setAutoDiscoverLoading(false);
    }
  }, [
    connected,
    publicKey,
    prefs.priorityMicros,
    prefs.computeUnitLimit,
    prefs.slippageBps,
    sendTransaction,
    connection,
    refreshPositions,
    autoDiscoverLoading,
    setShowModal,
  ]);

  const handleRunBatch = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      setShowModal(true);
      return;
    }
    try {
      await runBatch({
        priorityMicros: prefs.priorityMicros,
        computeUnitLimit: prefs.computeUnitLimit,
      });
    } catch (error) {
      console.error('[exit] batch run failed', error);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [connected, publicKey, runBatch, prefs.priorityMicros, prefs.computeUnitLimit, setShowModal]);

  const handleRunUniversal = useCallback(async () => {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      setShowModal(true);
      return;
    }
    try {
      await runUniversal({
        priorityMicros: prefs.priorityMicros,
        computeUnitLimit: prefs.computeUnitLimit,
        include: { dbc: prefs.includeDbc, dammv2: prefs.includeDammv2 },
      });
    } catch (error) {
      console.error('[exit] universal exit run failed', error);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [
    connected,
    publicKey,
    runUniversal,
    prefs.priorityMicros,
    prefs.computeUnitLimit,
    prefs.includeDbc,
    prefs.includeDammv2,
    setShowModal,
  ]);

  const totalPositions = positions.length;
  const batchDuration =
    batchState.startedAt && batchState.finishedAt
      ? formatDuration(batchState.startedAt, batchState.finishedAt)
      : '–';
  const universalDuration =
    universalState.startedAt && universalState.finishedAt
      ? formatDuration(universalState.startedAt, universalState.finishedAt)
      : '–';

  if (!connected) {
    return (
      <main className="max-w-3xl mx-auto p-8 min-h-screen flex flex-col items-center justify-center bg-neutral-900 text-neutral-100">
        <h1 className="text-3xl font-bold mb-4">DBC Exit & Fee Claim</h1>
        <p className="text-neutral-400 text-sm mb-6 text-center">
          Connect your wallet to discover Meteora DBC pools, claim accumulated fees, and withdraw
          liquidity in a single click.
        </p>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 px-5 rounded-md shadow"
        >
          Connect Wallet
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 text-neutral-100 bg-neutral-900 min-h-screen" role="main">
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold text-neutral-50">DBC One-Click Exit</h1>
          {poolLoading && <span className="text-xs text-neutral-400">Discovering pools…</span>}
          {!poolLoading && typeof totalPositions === 'number' && (
            <span className="inline-flex items-center rounded-full bg-neutral-800 text-xs px-3 py-1 border border-neutral-700/70">
              Positions detected: <strong className="ml-1">{totalPositions}</strong>
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-400 mt-2 max-w-3xl">
          Build and send real Meteora DBC claim / withdraw transactions. Adaptive retries, optional
          simulation, batch exit tooling, and a universal DBC + DAMM v2 planner are all available
          below. Preferences persist locally for repeat operations.
        </p>
        {poolError && <p className="text-xs text-amber-400 mt-2">Pool discovery warning: {poolError}</p>}
      </header>

      <section className="space-y-6 mb-10">
        <div className="rounded-lg border border-neutral-700 bg-neutral-850 p-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400">DBC Pool</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={selected === 'ALL' ? 'ALL' : selected?.id || ''}
                      onChange={(e) => setSelectedId(e.target.value as any)}
                      disabled={poolLoading}
                      className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100"
                    >
                      {pools.length > 1 && <option value="ALL">Auto-select largest pool</option>}
                      {pools.map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {pool.label}
                          {pool.tags?.length ? ` [${pool.tags.join(', ')}]` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        refreshPositions();
                        toast.success('Positions refreshed');
                      }}
                      disabled={posLoading}
                      className="text-xs px-2 py-1 border border-neutral-700 rounded bg-neutral-800 hover:bg-neutral-700"
                    >
                      {posLoading ? '…' : '↻'}
                    </button>
                  </div>
                  {targetPool && (
                    <p className="text-[11px] text-neutral-400">
                      Target: {targetPool.label} ({shortKey(targetPool.pool)})
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400">Exit Action</label>
                  <select
                    value={prefs.exitAction}
                    onChange={(e) =>
                      setPrefs((prev) => ({ ...prev, exitAction: e.target.value as ExitPreferences['exitAction'] }))
                    }
                    className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100"
                  >
                    {EXIT_ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-neutral-500">
                    {EXIT_ACTION_OPTIONS.find((opt) => opt.value === prefs.exitAction)?.description}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-400">Priority Fee (μ-lamports/cu)</span>
                  <input
                    type="number"
                    value={prefs.priorityMicros}
                    min={0}
                    max={3_000_000}
                    onChange={(e) =>
                      setPrefs((prev) => ({ ...prev, priorityMicros: Number(e.target.value) || 0 }))
                    }
                    className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-neutral-100"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-400">Compute Unit Limit</span>
                  <input
                    type="number"
                    value={prefs.computeUnitLimit ?? ''}
                    placeholder="Optional"
                    min={50_000}
                    max={1_400_000}
                    onChange={(e) =>
                      setPrefs((prev) => ({
                        ...prev,
                        computeUnitLimit: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                    className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-neutral-100"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-400">Slippage (bps)</span>
                  <input
                    type="number"
                    value={prefs.slippageBps}
                    min={1}
                    max={10_000}
                    onChange={(e) =>
                      setPrefs((prev) => ({ ...prev, slippageBps: Number(e.target.value) || 0 }))
                    }
                    className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-neutral-100"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-300">
                <label className="inline-flex items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    checked={prefs.simulateFirst && !prefs.fastMode}
                    disabled={prefs.fastMode}
                    onChange={(e) =>
                      setPrefs((prev) => ({ ...prev, simulateFirst: e.target.checked }))
                    }
                  />
                  Simulate first
                </label>
                <label className="inline-flex items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    checked={prefs.fastMode}
                    onChange={(e) =>
                      setPrefs((prev) => ({
                        ...prev,
                        fastMode: e.target.checked,
                        simulateFirst: e.target.checked ? false : prev.simulateFirst,
                      }))
                    }
                  />
                  Fast mode (skip simulation & prefer processed confirm)
                </label>
              </div>

              <div className="flex flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  onClick={handleExitSelected}
                  disabled={!targetPool || isExitActive}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:cursor-not-allowed"
                >
                  {isExitActive ? 'Processing…' : 'Exit Selected Pool'}
                </button>
                <button
                  type="button"
                  onClick={handleAutoOneClickExit}
                  disabled={autoDiscoverLoading}
                  className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700"
                >
                  {autoDiscoverLoading ? 'Building…' : 'One-Click Exit (Auto Discover)'}
                </button>
                <button
                  type="button"
                  onClick={abort}
                  disabled={!isExitActive}
                  className="px-3 py-2 rounded-md border border-red-500 text-red-300 disabled:opacity-50"
                >
                  Abort
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="px-3 py-2 rounded-md border border-neutral-600 text-neutral-300"
                >
                  Reset State
                </button>
              </div>
            </div>

            <div className="w-full lg:w-72 bg-neutral-900/60 border border-neutral-700 rounded-lg p-4 text-xs space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-200">Exit Status</h3>
                <p className="mt-1 text-neutral-400">Status: <span className="capitalize">{exitState.status}</span></p>
                <p className="text-neutral-400">Attempt: {exitState.attempt}</p>
                <p className="text-neutral-400">
                  Priority: {exitState.currentPriorityMicros?.toLocaleString?.() ?? prefs.priorityMicros}
                </p>
              </div>
              <div className="space-y-1">
                <h4 className="font-medium text-neutral-300">Timings</h4>
                <p className="text-neutral-400">Build: {formatDuration(exitState.timings.started, exitState.timings.built)}</p>
                <p className="text-neutral-400">Sign: {formatDuration(exitState.timings.built, exitState.timings.signed)}</p>
                <p className="text-neutral-400">Send → Confirm: {formatDuration(exitState.timings.sent, exitState.timings.confirmed)}</p>
                <p className="text-neutral-400">Total: {formatDuration(exitState.timings.started, exitState.timings.confirmed)}</p>
              </div>
              {exitState.signature && (
                <p className="text-neutral-300 break-all">
                  Signature:{' '}
                  <a
                    className="underline"
                    href={solscanUrl(exitState.signature, (connection as any).rpcEndpoint)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {exitState.signature}
                  </a>
                </p>
              )}
              {exitState.error && (
                <p className="text-red-400">Error: {exitState.error}</p>
              )}
              {exitState.timings.processed && (
                <p className="text-neutral-500">
                  Processed confirmation: {formatTimestamp(exitState.timings.processed)}
                </p>
              )}
              {exitState.simulation?.logs?.length ? (
                <details className="bg-neutral-900 rounded border border-neutral-700 p-2">
                  <summary className="cursor-pointer text-neutral-300">Simulation logs ({exitState.simulation.logs.length})</summary>
                  <ul className="mt-2 space-y-1 text-[11px] text-neutral-400 max-h-48 overflow-y-auto">
                    {exitState.simulation.logs.map((log, idx) => (
                      <li key={idx} className="break-all">
                        {log}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </div>
          {posError && <p className="text-xs text-red-400 mt-4">{posError}</p>}
        </div>
      </section>

      <section className="mb-10 space-y-4">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-neutral-300 select-none">
            <input
              type="checkbox"
              checked={prefs.autoBatchEnabled}
              onChange={(e) => setPrefs((prev) => ({ ...prev, autoBatchEnabled: e.target.checked }))}
            />
            Enable Auto Batch Exit (claim all pools sequentially)
          </label>
          {batchState.running && (
            <button
              type="button"
              onClick={abortBatch}
              className="text-xs px-3 py-1 rounded border border-red-400 text-red-300"
            >
              Abort Batch
            </button>
          )}
        </div>
        {prefs.autoBatchEnabled && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-850 p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleRunBatch}
                disabled={batchState.running}
                className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700"
              >
                {batchState.running ? 'Batch Running…' : 'Run Auto Batch Exit'}
              </button>
              <span className="text-xs text-neutral-400">
                Processes each discovered pool sequentially. Uses claim-only transactions today.
              </span>
            </div>
            <div className="text-xs text-neutral-300 space-y-1">
              <p>
                Running: <strong>{batchState.running ? 'yes' : 'no'}</strong> • Items:{' '}
                <strong>{batchState.items.length}</strong>
              </p>
              <p>
                Current index: <strong>{batchState.currentIndex + 1}</strong>
              </p>
              <p>Elapsed: {batchDuration}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border border-neutral-700 rounded-md">
                <thead className="bg-neutral-800 text-neutral-300">
                  <tr>
                    <th className="px-3 py-2">Pool</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Signature / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {batchState.items.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-neutral-500">
                        Run the batch exit to populate results.
                      </td>
                    </tr>
                  )}
                  {batchState.items.map((item, idx) => (
                    <tr key={`${item.pool}-${idx}`} className="border-t border-neutral-800">
                      <td className="px-3 py-2">{shortKey(item.pool)}</td>
                      <td className="px-3 py-2 capitalize">{item.mode}</td>
                      <td className="px-3 py-2 capitalize">{item.status}</td>
                      <td className="px-3 py-2">
                        {item.signature ? (
                          <a
                            className="underline"
                            href={solscanUrl(item.signature, (connection as any).rpcEndpoint)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortKey(item.signature, 6)}
                          </a>
                        ) : item.error ? (
                          <span className="text-red-400">{item.error.slice(0, 120)}</span>
                        ) : (
                          <span className="text-neutral-500">–</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="mb-10 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-neutral-100">Universal Exit (DBC + DAMM v2)</h2>
          {universalState.running && (
            <button
              type="button"
              onClick={abortUniversal}
              className="text-xs px-3 py-1 rounded border border-red-400 text-red-300"
            >
              Abort Universal Exit
            </button>
          )}
        </div>
        <div className="rounded-lg border border-neutral-700 bg-neutral-850 p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-300">
            <label className="inline-flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={prefs.includeDbc}
                onChange={(e) => setPrefs((prev) => ({ ...prev, includeDbc: e.target.checked }))}
              />
              Include DBC claim tasks
            </label>
            <label className="inline-flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={prefs.includeDammv2}
                onChange={(e) => setPrefs((prev) => ({ ...prev, includeDammv2: e.target.checked }))}
              />
              Include DAMM v2 withdraw tasks
            </label>
            <button
              type="button"
              onClick={handleRunUniversal}
              disabled={universalState.running || universalState.planning}
              className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700"
            >
              {universalState.planning
                ? 'Planning…'
                : universalState.running
                ? 'Executing…'
                : 'Run Universal Exit All'}
            </button>
          </div>
          <div className="text-xs text-neutral-300 space-y-1">
            <p>
              Planning: <strong>{universalState.planning ? 'yes' : 'no'}</strong> • Running:{' '}
              <strong>{universalState.running ? 'yes' : 'no'}</strong>
            </p>
            <p>
              Items: <strong>{universalState.items.length}</strong> • Current index:{' '}
              <strong>{universalState.currentIndex + 1}</strong>
            </p>
            <p>Elapsed: {universalDuration}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border border-neutral-700 rounded-md">
              <thead className="bg-neutral-800 text-neutral-300">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Protocol</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Identifier</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Signature / Error</th>
                </tr>
              </thead>
              <tbody>
                {universalState.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-neutral-500">
                      Run the universal exit planner to populate tasks.
                    </td>
                  </tr>
                )}
                {universalState.items.map((item, idx) => (
                  <tr key={`${item.protocol}-${idx}`} className="border-t border-neutral-800">
                    <td className="px-3 py-2">{idx + 1}</td>
                    <td className="px-3 py-2 uppercase">{item.protocol}</td>
                    <td className="px-3 py-2 capitalize">{item.kind}</td>
                    <td className="px-3 py-2">
                      {item.protocol === 'dbc'
                        ? shortKey(item.pool ?? '')
                        : shortKey(item.position ?? '')}
                    </td>
                    <td className="px-3 py-2 capitalize">{item.status}</td>
                    <td className="px-3 py-2">
                      {item.signature ? (
                        <a
                          className="underline"
                          href={solscanUrl(item.signature, (connection as any).rpcEndpoint)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortKey(item.signature, 6)}
                        </a>
                      ) : item.error ? (
                        <span className="text-red-400">{item.error.slice(0, 120)}</span>
                      ) : (
                        <span className="text-neutral-500">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-semibold text-neutral-100 mb-3">Discovered Positions</h2>
        <p className="text-sm text-neutral-400 mb-4">
          Full table of detected DBC LP balances. Use "Instant Exit" in each row for granular control
          or rely on the single-click buttons above.
        </p>
        <TxTable className="bg-neutral-850 border border-neutral-800 rounded-lg" />
      </section>

      {debugMode && (
        <section className="mb-12">
          <div className="rounded-lg border border-red-600/40 bg-red-950/30 p-5">
            <h2 className="text-lg font-semibold text-red-200 mb-2">Debug Mode</h2>
            <p className="text-xs text-red-200 mb-3">
              Query parameter <code>?debug=1</code> is active. Raw NFT discovery results are shown for
              troubleshooting migrations.
            </p>
            {debugLoading ? (
              <p className="text-red-200 text-sm">Loading debug positions…</p>
            ) : debugPositions.length === 0 ? (
              <p className="text-red-200 text-sm">No NFT-style positions detected.</p>
            ) : (
              <ul className="space-y-2 text-xs text-red-100">
                {debugPositions.map((pos, idx) => (
                  <li key={`${pos.mint}-${idx}`} className="border border-red-700/50 rounded p-3">
                    <div>Mint: {pos.mint}</div>
                    <div>Token Account: {pos.tokenAccount}</div>
                    {pos.name && <div>Name: {pos.name}</div>}
                    {pos.symbol && <div>Symbol: {pos.symbol}</div>}
                    {pos.updateAuthority && <div>Update Authority: {pos.updateAuthority}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
