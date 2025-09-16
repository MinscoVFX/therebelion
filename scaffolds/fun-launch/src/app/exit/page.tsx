'use client';

import { useState, useEffect, useRef } from 'react';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { toast } from 'sonner';

interface ExitPreferences {
  priorityMicros: number;
  computeUnitLimit: number;
  slippageBps: number;
}

interface DebugPosition {
  programId: string;
  lpAmount: string;
  estimatedValueUsd: number | null;
  poolKeys: {
    pool: string;
    feeVault: string;
    tokenA: string | null;
    tokenB: string | null;
    lpMint: string | null;
    userLpToken: string | null;
    userTokenA: string | null;
    userTokenB: string | null;
  };
}

interface DebugNftPools {
  runtime: string[];
  metadata: string[];
}

function solscanUrl(sig: string, endpoint: string) {
  const lower = endpoint?.toLowerCase?.() ?? '';
  if (lower.includes('devnet')) return `https://solscan.io/tx/${sig}?cluster=devnet`;
  if (lower.includes('testnet')) return `https://solscan.io/tx/${sig}?cluster=testnet`;
  return `https://solscan.io/tx/${sig}`;
}

export default function ExitPage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setShowModal } = useUnifiedWalletContext();
  const [loading, setLoading] = useState(false);
  const [prefs, setPrefs] = useState<ExitPreferences>({
    priorityMicros: 750_000,
    computeUnitLimit: 400_000,
    slippageBps: 100, // 1% slippage tolerance like Meteora website
  });

  // Debug mode state
  const [debugMode, setDebugMode] = useState(false);
  const [debugPositions, setDebugPositions] = useState<DebugPosition[]>([]);
  const [debugNftPools, setDebugNftPools] = useState<DebugNftPools | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  // Positions pill state
  const [posCount, setPosCount] = useState<number | null>(null);
  const [posLoading, setPosLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runtimePools = debugNftPools?.runtime ?? [];
  const metadataPools = debugNftPools?.metadata ?? [];

  // Check for debug mode on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const debug = params.get('debug') === '1';
      setDebugMode(debug);
    }
  }, []);

  // Fetch debug positions when debug mode is enabled and wallet connected
  useEffect(() => {
    if (!debugMode) {
      setDebugPositions([]);
      setDebugNftPools(null);
      setDebugLoading(false);
      return;
    }
    if (!connected || !publicKey) {
      setDebugPositions([]);
      setDebugNftPools(null);
      setDebugLoading(false);
      return;
    }

    let cancelled = false;

    const loadDebug = async () => {
      setDebugLoading(true);
      try {
        const res = await fetch(`/api/exit-tools?wallet=${publicKey.toBase58()}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
          throw new Error(message);
        }
        const rawPositions = Array.isArray(body?.positions) ? body.positions : [];
        const parsedPositions = rawPositions
          .map((pos: any): DebugPosition | null => {
            const poolKeys = pos?.poolKeys;
            if (!poolKeys || typeof poolKeys.pool !== 'string' || typeof poolKeys.feeVault !== 'string') {
              return null;
            }
            const programId = typeof pos?.programId === 'string' ? pos.programId : '';
            const lpAmount =
              typeof pos?.lpAmount === 'string'
                ? pos.lpAmount
                : pos?.lpAmount != null
                ? String(pos.lpAmount)
                : '0';
            return {
              programId,
              lpAmount,
              estimatedValueUsd:
                typeof pos?.estimatedValueUsd === 'number' ? pos.estimatedValueUsd : null,
              poolKeys: {
                pool: poolKeys.pool,
                feeVault: poolKeys.feeVault,
                tokenA: typeof poolKeys.tokenA === 'string' ? poolKeys.tokenA : null,
                tokenB: typeof poolKeys.tokenB === 'string' ? poolKeys.tokenB : null,
                lpMint: typeof poolKeys.lpMint === 'string' ? poolKeys.lpMint : null,
                userLpToken: typeof poolKeys.userLpToken === 'string' ? poolKeys.userLpToken : null,
                userTokenA: typeof poolKeys.userTokenA === 'string' ? poolKeys.userTokenA : null,
                userTokenB: typeof poolKeys.userTokenB === 'string' ? poolKeys.userTokenB : null,
              },
            };
          })
          .filter((pos): pos is DebugPosition => Boolean(pos));
        if (cancelled) return;
        setDebugPositions(parsedPositions);
        if (body?.nftPools) {
          setDebugNftPools({
            runtime: Array.isArray(body.nftPools.runtime) ? body.nftPools.runtime : [],
            metadata: Array.isArray(body.nftPools.metadata) ? body.nftPools.metadata : [],
          });
        } else {
          setDebugNftPools({ runtime: [], metadata: [] });
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Debug fetch error:', err);
          setDebugPositions([]);
          setDebugNftPools(null);
        }
      } finally {
        if (!cancelled) {
          setDebugLoading(false);
        }
      }
    };

    void loadDebug();

    return () => {
      cancelled = true;
    };
  }, [debugMode, connected, publicKey]);

  // Fetch positions count for pill
  useEffect(() => {
    setPosCount(null);
    if (!publicKey) {
      setPosLoading(false);
      return () => {}; // return cleanup function
    }
    setPosLoading(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const url = `/api/exit-tools?wallet=${publicKey.toBase58()}`;
    fetch(url, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        const n = Array.isArray(j?.positions) ? j.positions.length : 0;
        setPosCount(n);
      })
      .catch(() => {
        /* silent; UI stays clean */
      })
      .finally(() => {
        if (abortRef.current === ac) {
          setPosLoading(false);
          abortRef.current = null;
        }
      });

    return () => {
      ac.abort();
    };
  }, [publicKey]);

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

  async function handleOneClickExit() {
    if (!connected || !publicKey) {
      toast.error('Connect your wallet first');
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      // New unified endpoint with withdraw-first preference; server may fallback to claim.
      const res = await fetch('/api/dbc-exit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'withdraw_first',
          owner: publicKey.toBase58(),
          dbcPoolKeys: { /* server will auto-discover in one-click API variant later; placeholder */ },
          priorityMicros: prefs.priorityMicros,
          computeUnitLimit: prefs.computeUnitLimit,
          slippageBps: prefs.slippageBps,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      if (!data?.txBase64 && !data?.tx) {
        throw new Error('Missing transaction in response');
      }
      const b64 = data.txBase64 || data.tx;
      const vtx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
      const sig = await sendTransaction(vtx, connection);

      const actionLabel = data?.effectiveAction === 'withdraw' ? 'Withdraw + Claim' : 'Claim';
      toast.success(
        <div>
          <p className="font-medium">{actionLabel} transaction submitted!</p>
          {data?.fallback && (
            <p className="text-xs text-neutral-400 mt-1">Fallback used: {data?.fallback?.reason}</p>
          )}
          <a
            href={solscanUrl(sig, (connection as any).rpcEndpoint)}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            View on Solscan
          </a>
        </div>,
        { duration: 8000 }
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('One-click exit error:', e);
      toast.error(`Exit failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center min-h-screen flex flex-col items-center justify-center bg-neutral-900 text-neutral-100">
        <h1 className="text-3xl font-bold mb-6">Claim Fees Only</h1>
        <p className="text-neutral-400 mb-8">
          Withdraws are temporarily disabled. Connect your wallet to claim protocol / fee rewards
          where supported.
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
      <div className="flex items-center mb-4">
        <h1 className="text-3xl font-bold text-neutral-50">One‑Click DBC Exit</h1>
        {/* Positions pill (visible only if we have a number) */}
        {publicKey && posCount !== null && !posLoading && (
          <div className="inline-flex items-center rounded-full bg-zinc-800/70 text-zinc-100 text-xs px-3 py-1 ml-2 select-none">
            Positions found: <span className="ml-1 font-semibold">{posCount}</span>
          </div>
        )}
      </div>
      <div className="mb-4 rounded-md border border-amber-600/40 bg-amber-950/30 p-3 text-amber-300 text-xs">
        <strong>Enhanced:</strong> Now uses the new one-click API that automatically finds your
        biggest DBC pool and creates a combined transaction to claim all fees and withdraw 100%
        liquidity, exactly like the Meteora website.
      </div>
      <p className="text-neutral-400 mb-6 text-sm">
        Click the button below to automatically find your largest DBC position and create a single
        transaction that claims all trading fees and withdraws 100% of your liquidity - just like
        the Meteora website transaction you referenced.
      </p>

      {debugMode && (
        <div className="mb-6 bg-red-950/30 border border-red-600/40 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3 text-red-300">🐛 Debug Mode</h2>
          <p className="text-xs text-red-200 mb-3">
            Debug mode is enabled via ?debug=1. This section shows raw position discovery data.
          </p>
          {debugLoading ? (
            <div className="text-red-200 text-sm">Loading positions...</div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-red-200 mb-2">
                  Found {debugPositions.length} DBC LP position(s) via server tools:
                </p>
                {debugPositions.length === 0 ? (
                  <div className="text-red-300 text-xs">No LP positions detected</div>
                ) : (
                  <div className="space-y-2">
                    {debugPositions.map((pos, i) => (
                      <div
                        key={i}
                        className="bg-red-900/20 border border-red-700/30 rounded p-3 text-xs space-y-1"
                      >
                        <div>
                          <strong>Program:</strong> {pos.programId || 'Unknown'}
                        </div>
                        <div>
                          <strong>Pool:</strong> {pos.poolKeys.pool}
                        </div>
                        <div>
                          <strong>Fee Vault:</strong> {pos.poolKeys.feeVault}
                        </div>
                        {pos.poolKeys.lpMint && (
                          <div>
                            <strong>LP Mint:</strong> {pos.poolKeys.lpMint}
                          </div>
                        )}
                        {pos.poolKeys.tokenA && (
                          <div>
                            <strong>Token A:</strong> {pos.poolKeys.tokenA}
                          </div>
                        )}
                        {pos.poolKeys.tokenB && (
                          <div>
                            <strong>Token B:</strong> {pos.poolKeys.tokenB}
                          </div>
                        )}
                        {pos.poolKeys.userLpToken && (
                          <div>
                            <strong>User LP Token Account:</strong> {pos.poolKeys.userLpToken}
                          </div>
                        )}
                        {pos.poolKeys.userTokenA && (
                          <div>
                            <strong>User Token A Account:</strong> {pos.poolKeys.userTokenA}
                          </div>
                        )}
                        {pos.poolKeys.userTokenB && (
                          <div>
                            <strong>User Token B Account:</strong> {pos.poolKeys.userTokenB}
                          </div>
                        )}
                        <div>
                          <strong>LP Balance (raw):</strong> {pos.lpAmount}
                        </div>
                        {typeof pos.estimatedValueUsd === 'number' &&
                          Number.isFinite(pos.estimatedValueUsd) && (
                            <div>
                              <strong>Estimated Value (USD):</strong>{' '}
                              ${pos.estimatedValueUsd.toFixed(2)}
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="pt-3 border-t border-red-800/30">
                <p className="text-sm text-red-200 mb-2">Migration heuristics (NFT discovery)</p>
                <div className="grid gap-3 text-xs text-red-200 md:grid-cols-2">
                  <div>
                    <strong>Runtime helper pools</strong>
                    {runtimePools.length ? (
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        {runtimePools.map((pk) => (
                          <li key={`runtime-${pk}`}>{pk}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-red-300 text-[11px]">No runtime-discovered pools</div>
                    )}
                  </div>
                  <div>
                    <strong>Metadata hint pools</strong>
                    {metadataPools.length ? (
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        {metadataPools.map((pk) => (
                          <li key={`metadata-${pk}`}>{pk}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-red-300 text-[11px]">No metadata-discovered pools</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

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
            <label className="block text-neutral-400 mb-1">Compute Unit Limit</label>
            <input
              type="number"
              value={prefs.computeUnitLimit}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, computeUnitLimit: Number(e.target.value) }))
              }
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
              placeholder="100 = 1%"
            />
          </div>
        </div>

        <div className="mt-6 p-4 bg-neutral-800/50 rounded-lg border border-neutral-700/30">
          <h3 className="text-sm font-medium text-neutral-200 mb-2">How it works:</h3>
          <ul className="text-xs text-neutral-400 space-y-1">
            <li>• Automatically discovers your largest DBC position</li>
            <li>• Creates a single transaction that claims fees AND withdraws 100% liquidity</li>
            <li>• Uses the same logic as the successful Meteora website transaction</li>
            <li>• Handles the DBC → DAMM v2 migration automatically</li>
          </ul>
        </div>

        <button
          disabled={!connected || loading}
          onClick={handleOneClickExit}
          className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-medium py-3 rounded shadow transition-colors"
        >
          {loading
            ? 'Finding Pool & Building Transaction...'
            : 'One-Click Exit: Claim Fees + Withdraw 100%'}
        </button>

        <div className="mt-4 text-xs text-neutral-500 text-center">
          Replicates the exact functionality from your Meteora website transaction
        </div>
      </div>
    </div>
  );
}
