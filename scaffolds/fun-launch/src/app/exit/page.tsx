'use client';

import React, { useState, useEffect } from 'react';
import { useUnifiedWalletContext } from '@jup-ag/wallet-adapter';
import { useWallet } from '@solana/wallet-adapter-react';
import { useUniversalExit } from '../../hooks/useUniversalExit';
import { useDerivedDammV2Pools } from '../../hooks/useDerivedDammV2Pools';

interface ExitPreferences {
  priorityMicros: number;
  computeUnitLimit: number;
  slippageBps: number;
}

// one-click endpoint disabled pre-migration; explorer helper removed

export default function ExitPage() {
  const { connected } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  // one-click flow disabled; loading state unnecessary
  const [prefs, setPrefs] = useState<ExitPreferences>({
    priorityMicros: 750_000,
    computeUnitLimit: 400_000,
    slippageBps: 100, // 1% slippage tolerance like Meteora website
  });
  const { run: runUniversalExit, state: universalState } = useUniversalExit();
  const { positions: derivedPositions, loading: derivedLoading } = useDerivedDammV2Pools();

  // Whether a NEXT_PUBLIC_MIGRATED_DBC_POOLS env var is provided to the client build.
  const hasMigratedPoolsEnv =
    typeof process !== 'undefined' &&
    Boolean(
      // NEXT_PUBLIC_ prefix is available client-side when set at build/deploy time
      (process.env as any).NEXT_PUBLIC_MIGRATED_DBC_POOLS
    );

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

  // One‑click handler removed (endpoint disabled pre‑migration)

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
      <h1 className="text-3xl font-bold mb-4 text-neutral-50">One-Click DBC Exit</h1>
      <div className="mb-4 rounded-md border border-amber-600/40 bg-amber-950/30 p-3 text-amber-300 text-xs">
        <strong>Disabled pre‑migration:</strong> One‑click DBC exit is unavailable. Use
        <span className="font-semibold"> Universal Exit</span> below (claims DBC fees and removes
        DAMM v2 liquidity).
      </div>
      {!hasMigratedPoolsEnv && (
        <div className="mb-4 rounded-md border border-yellow-500/30 bg-yellow-950/20 p-3 text-yellow-300 text-xs">
          <strong>Note:</strong> `NEXT_PUBLIC_MIGRATED_DBC_POOLS` is not set in this build. The
          Universal Exit flow will discover positions from your wallet. To whitelist migrated pools
          (silence planner warnings), set the <code>NEXT_PUBLIC_MIGRATED_DBC_POOLS</code>
          environment variable in Vercel as a comma-separated list of pool addresses and redeploy.
        </div>
      )}
      <p className="text-neutral-400 mb-6 text-sm">
        The dedicated one‑click endpoint returns 501 to steer users to the Universal Exit flow
        during migration. Universal Exit will automatically discover your positions and perform
        claim + 100% DAMM v2 liquidity removal with slippage protection.
      </p>

      <div className="mt-8 bg-neutral-850 rounded-lg border border-neutral-700/60 p-6">
        <h2 className="text-lg font-semibold mb-4 text-neutral-50">Exit Parameters</h2>
        <div className="mb-3 text-xs text-neutral-400">
          {derivedLoading ? (
            <>Scanning your DAMM v2 NFT positions…</>
          ) : (
            <>
              Detected{' '}
              <span className="text-neutral-200 font-medium">{derivedPositions.length}</span> DAMM
              v2 position{derivedPositions.length === 1 ? '' : 's'} from your wallet.
            </>
          )}
        </div>
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
          disabled={true}
          onClick={() => {}}
          title="Disabled pre-migration"
          className="mt-6 w-full bg-neutral-800 text-neutral-400 cursor-not-allowed font-medium py-3 rounded border border-neutral-700"
        >
          One‑Click Exit is disabled (use Universal Exit below)
        </button>

        <div className="mt-4 text-xs text-neutral-400 text-center">
          This action will be re‑enabled post‑migration.
        </div>

        <div className="mt-10 flex flex-col gap-3">
          <button
            onClick={async () => {
              // Defensive wrapper: ensure any error is surfaced to the user and console
              try {
                // log immediate click for quick feedback in console
                // include prefs, positions summary, and current state to aid debugging
                // eslint-disable-next-line no-console
                console.log('Universal Exit clicked', { prefs });
                // eslint-disable-next-line no-console
                console.log(
                  'Universal Exit - derivedPositions (count)',
                  derivedPositions?.length ?? 0
                );
                try {
                  // eslint-disable-next-line no-console
                  console.debug(
                    'Universal Exit - derivedPositions (preview)',
                    JSON.parse(JSON.stringify(derivedPositions?.slice(0, 5) ?? []))
                  );
                } catch {
                  // ignore circular structure issues
                }
                // eslint-disable-next-line no-console
                console.log('Universal Exit - universalState', universalState);

                const payload = {
                  slippageBps: prefs.slippageBps,
                  priorityMicros: prefs.priorityMicros,
                  include: { dbc: true, dammv2: true },
                };
                // eslint-disable-next-line no-console
                console.log('Universal Exit - payload', payload);

                // If migrated pools env is not set, provide actionable console guidance once.
                if (!hasMigratedPoolsEnv) {
                  // eslint-disable-next-line no-console
                  console.info(
                    '[universal-exit] To set migrated pools for this deployment (Vercel):'
                  );
                  // eslint-disable-next-line no-console
                  console.info(
                    "Set the Vercel Environment Variable 'NEXT_PUBLIC_MIGRATED_DBC_POOLS' to a comma-separated list of pool addresses (e.g. POOL_PUBKEY1,POOL_PUBKEY2) and redeploy."
                  );
                }

                await runUniversalExit(payload);

                // eslint-disable-next-line no-console
                console.info('Universal Exit completed successfully');
              } catch (err: any) {
                // Surface error so users don't see a silent failure
                // eslint-disable-next-line no-console
                console.error('Universal Exit failed', err);
                try {
                  // prefer stack for debugging but fall back to message
                  const msg = err?.stack || err?.message || String(err) || 'Universal Exit failed';
                  // show a simple alert fallback if no toast system available
                  alert(msg);
                } catch {
                  // ignore alert failure
                }
              }
            }}
            disabled={universalState.running || derivedLoading || derivedPositions.length === 0}
            className={`px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 ${
              derivedLoading || derivedPositions.length === 0 ? 'cursor-not-allowed' : ''
            }`}
            title={
              derivedLoading
                ? 'Scanning wallet for DAMM v2 positions…'
                : derivedPositions.length === 0
                  ? 'No DAMM v2 positions detected in your wallet'
                  : undefined
            }
          >
            {universalState.running
              ? 'Exiting…'
              : derivedLoading
                ? 'Scanning…'
                : derivedPositions.length === 0
                  ? 'No DAMM v2 positions'
                  : 'Universal Exit (DBC fees + DAMM v2 withdraw)'}
          </button>
        </div>
      </div>
    </div>
  );
}
