import { useState, useCallback, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { assertOnlyAllowedUnsignedSigners } from '../lib/txSigners';

export interface DbcPoolKeys {
  pool: string;
  feeVault: string;
}

export interface ExitOptions {
  dbcPoolKeys: DbcPoolKeys;
  action?: 'claim' | 'withdraw' | 'claim_and_withdraw';
  priorityMicros?: number;
  slippageBps?: number;
  simulateFirst?: boolean;
  fastMode?: boolean;
  computeUnitLimit?: number;
}

export interface ExitTimings {
  started?: number;
  built?: number;
  signed?: number;
  sent?: number;
  processed?: number;
  confirmed?: number;
}

export interface SimulationResult {
  logs: string[];
  unitsConsumed: number;
  error?: any;
}

export interface ExitState {
  status: 'idle' | 'building' | 'signing' | 'sending' | 'confirming' | 'success' | 'error';
  attempt: number;
  currentPriorityMicros: number;
  simulation?: SimulationResult;
  signature?: string;
  timings: ExitTimings;
  error?: string;
}

export function useDbcInstantExit() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<ExitState>({
    status: 'idle',
    attempt: 0,
    currentPriorityMicros: 0,
    timings: {},
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      attempt: 0,
      currentPriorityMicros: 0,
      timings: {},
    });
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
    setState((prev) => ({
      ...prev,
      status: 'error',
      error: 'Aborted by user',
    }));
  }, []);

  const exit = useCallback(
    async (options: ExitOptions): Promise<string | undefined> => {
      if (!publicKey || !signTransaction) {
        throw new Error('Wallet not connected');
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const maxAttempts = 3;
      let currentAttempt = 0;
      let currentPriority = options.priorityMicros || 250_000;

      const timings: ExitTimings = { started: Date.now() };

      setState({
        status: 'building',
        attempt: 1,
        currentPriorityMicros: currentPriority,
        timings,
      });

      while (currentAttempt < maxAttempts) {
        if (abortController.signal.aborted) {
          setState((prev) => ({ ...prev, status: 'error', error: 'Aborted' }));
          return undefined;
        }

        currentAttempt++;

        try {
          // Build transaction
          setState((prev) => ({
            ...prev,
            status: 'building',
            attempt: currentAttempt,
            currentPriorityMicros: currentPriority,
          }));

          // Simulate first if requested and it's the first attempt
          if (options.simulateFirst && currentAttempt === 1 && !options.fastMode) {
            const simResponse = await fetch('/api/dbc-exit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                owner: publicKey.toString(),
                dbcPoolKeys: options.dbcPoolKeys,
                action: options.action || 'claim',
                priorityMicros: currentPriority,
                slippageBps: options.slippageBps,
                simulateOnly: true,
                computeUnitLimit: options.computeUnitLimit,
              }),
              signal: abortController.signal,
            });

            if (!simResponse || typeof (simResponse as any).ok !== 'boolean') {
              throw new Error('Simulation failed: No response');
            }
            if (!simResponse.ok) {
              throw new Error(`Simulation failed: ${simResponse.statusText}`);
            }

            interface SimJson {
              error?: any;
              logs?: string[];
              unitsConsumed?: number;
              tx?: string;
              lastValidBlockHeight?: number;
            }
            const simText = await simResponse.text();
            if (!simText) throw new Error('Simulation returned empty response body');
            let simResult: SimJson;
            try {
              simResult = JSON.parse(simText) as SimJson;
            } catch (e) {
              throw new Error('Simulation JSON parse failed: ' + (e as any)?.message);
            }
            if (simResult.error) {
              throw new Error(`Simulation error: ${JSON.stringify(simResult.error)}`);
            }

            setState((prev) => ({
              ...prev,
              simulation: {
                logs: simResult.logs || [],
                unitsConsumed: simResult.unitsConsumed || 0,
                error: simResult.error,
              },
            }));
          }

          // Build actual transaction
          const response = await fetch('/api/dbc-exit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              owner: publicKey.toString(),
              dbcPoolKeys: options.dbcPoolKeys,
              action: options.action || 'claim',
              priorityMicros: currentPriority,
              slippageBps: options.slippageBps,
              simulateOnly: false,
              computeUnitLimit: options.computeUnitLimit,
            }),
            signal: abortController.signal,
          });

          if (!response || typeof (response as any).ok !== 'boolean') {
            throw new Error('API error: No response');
          }
          if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
          }

          interface BuildJson {
            error?: string;
            tx: string;
            lastValidBlockHeight: number;
          }
          const buildText = await response.text();
          if (!buildText) throw new Error('Build returned empty response body');
          let result: BuildJson;
          try {
            result = JSON.parse(buildText) as BuildJson;
          } catch (e) {
            throw new Error('Build JSON parse failed: ' + (e as any)?.message);
          }
          if (result.error) {
            throw new Error(result.error);
          }

          timings.built = Date.now();
          setState((prev) => ({ ...prev, timings: { ...prev.timings, built: Date.now() } }));

          // Sign transaction
          setState((prev) => ({ ...prev, status: 'signing' }));

          const tx = VersionedTransaction.deserialize(Buffer.from(result.tx, 'base64'));
          // Proactive signer validation (wallet should be the only remaining required unsigned signer)
          try {
            assertOnlyAllowedUnsignedSigners(tx, [publicKey]);
          } catch (e: any) {
            throw new Error('Signer validation failed: ' + (e?.message || e));
          }
          const signedTx = await signTransaction(tx);

          timings.signed = Date.now();
          setState((prev) => ({ ...prev, timings: { ...prev.timings, signed: Date.now() } }));

          // Send transaction
          setState((prev) => ({ ...prev, status: 'sending' }));

          const signature = await connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: options.fastMode,
            maxRetries: 0,
          });

          timings.sent = Date.now();
          setState((prev) => ({
            ...prev,
            status: 'confirming',
            signature,
            timings: { ...prev.timings, sent: Date.now() },
          }));

          // Confirm transaction
          if (options.fastMode) {
            // Try processed first, then confirmed
            try {
              await connection.confirmTransaction(
                {
                  signature,
                  blockhash: tx.message.recentBlockhash!,
                  lastValidBlockHeight: result.lastValidBlockHeight,
                },
                'processed'
              );

              timings.processed = Date.now();
              setState((prev) => ({
                ...prev,
                timings: { ...prev.timings, processed: Date.now() },
              }));
            } catch (err) {
              console.warn('Processed confirmation failed, waiting for confirmed:', err);
            }
          }

          await connection.confirmTransaction(
            {
              signature,
              blockhash: tx.message.recentBlockhash!,
              lastValidBlockHeight: result.lastValidBlockHeight,
            },
            'confirmed'
          );

          timings.confirmed = Date.now();
          setState((prev) => ({
            ...prev,
            status: 'success',
            timings: { ...prev.timings, confirmed: Date.now() },
          }));

          return signature;
        } catch (error) {
          console.error(`Attempt ${currentAttempt} failed:`, error);

          if (abortController.signal.aborted) {
            setState((prev) => ({ ...prev, status: 'error', error: 'Aborted' }));
            return undefined;
          }

          if (currentAttempt >= maxAttempts) {
            // Final attempt failed
            const errorMessage = error instanceof Error ? error.message : String(error);
            setState((prev) => ({
              ...prev,
              status: 'error',
              error: parseErrorMessage(errorMessage),
            }));
            throw error;
          }

          // Retry with higher priority
          currentPriority = Math.min(currentPriority * 1.35, 3_000_000);

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
        }
      }
      return undefined;
    },
    [connection, publicKey, signTransaction]
  );

  return {
    state,
    exit,
    abort,
    reset,
  };
}

function parseErrorMessage(error: string): string {
  if (error.includes('blockhash')) return 'Blockhash expired - network congestion, retried';
  if (error.includes('insufficient')) return 'Insufficient SOL for fees';
  if (error.includes('slippage')) return 'Slippage or output below minimum';
  if (error.includes('0x1771')) return 'Pool not found or invalid';
  if (error.includes('0x1772')) return 'No claimable fees available';
  return error;
}
