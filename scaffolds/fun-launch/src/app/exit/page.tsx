'use client';

import { useState, useEffect } from 'react';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { toast } from 'sonner';
import { useUniversalExit } from '../../hooks/useUniversalExit';
import OneClickExitAutoButton from '../../components/OneClickExitAutoButton';

interface ExitPreferences {
  priorityMicros: number;
  computeUnitLimit: number;
  slippageBps: number;
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
  const { run: runUniversalExit, state: universalState } = useUniversalExit();

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
    if (loading) return; // prevent double clicks

    setLoading(true);
    try {
      // Call the new one-click DBC exit API
      const res = await fetch('/api/dbc-one-click-exit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerPubkey: publicKey.toBase58(),
          priorityMicros: prefs.priorityMicros,
          computeUnitLimit: prefs.computeUnitLimit,
          slippageBps: prefs.slippageBps,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.tx) {
        throw new Error(data?.error || 'Failed to build transaction');
      }

      // Sign and send the transaction
      const vtx = VersionedTransaction.deserialize(Buffer.from(data.tx, 'base64'));
      const sig = await sendTransaction(vtx, connection);

      toast.success(
        <div>
          <p className="font-medium">Exit transaction submitted!</p>
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
      <h1 className="text-3xl font-bold mb-4 text-neutral-50">One-Click DBC Exit</h1>
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

        <div className="mt-10 flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <OneClickExitAutoButton />
            <button
              onClick={() =>
                runUniversalExit({
                  slippageBps: prefs.slippageBps,
                  priorityMicros: prefs.priorityMicros,
                  include: { dbc: true, dammv2: true },
                })
              }
              disabled={universalState.running}
              className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            >
              {universalState.running ? 'Exiting…' : 'Universal Exit (slippage protected)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
