import {
  VersionedTransaction,
  Connection,
  PublicKey,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { resolveRpc } from '../lib/rpc';

export interface UniversalExitTask {
  protocol: 'dbc' | 'dammv2';
  kind: 'claim' | 'withdraw';
  pool?: string; // common identifier
  feeVault?: string; // dbc
  position?: string; // damm v2 position nft
  tx: string; // base64 serialized versioned transaction
  lastValidBlockHeight: number;
  // Optional: multiple pre-built priority variants (first is the default)
  priorityTxs?: Array<{
    tx: string;
    lastValidBlockHeight: number;
    priorityMicros: number;
  }>;
}

export interface PlanOptions {
  owner: string;
  priorityMicros?: number;
  computeUnitLimit?: number; // reserved (only used in dbc path currently)
  include?: { dbc?: boolean; dammv2?: boolean };
  slippageBps?: number; // optional: forwarded to API routes when provided
}

// Small helper to POST JSON and parse (throws on !ok) with empty-body safety.
async function postJson<T = any>(url: string, body: any): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    // Attempt to read text (may be empty) for diagnostics
    const maybeText = await resp.text().catch(() => '');
    throw new Error(
      `${url} failed: ${resp.status}${maybeText ? ` body:${maybeText.slice(0, 200)}` : ''}`
    );
  }
  // Some serverless platforms can yield empty 200 responses under race conditions; guard against that.
  const text = await resp.text();
  if (!text) {
    return {} as unknown as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Failed to parse JSON from ${url}: ${(e as any)?.message}`);
  }
}

export async function planUniversalExits(opts: PlanOptions): Promise<UniversalExitTask[]> {
  const { owner, priorityMicros, computeUnitLimit, slippageBps } = opts;
  const includeDbc = opts.include?.dbc !== false; // default true
  const includeDamm = opts.include?.dammv2 !== false; // default true

  // Discover DBC and DAMM positions in parallel (best-effort)
  const [dbcDiscovery, dammDiscovery] = await Promise.allSettled([
    includeDbc
      ? postJson<{ positions?: any[]; nftPools?: string[] }>('/api/dbc-discover', { owner })
      : Promise.resolve({ positions: [] } as any),
    includeDamm
      ? postJson<{ positions?: any[] }>('/api/dammv2-discover', { owner })
      : Promise.resolve({ positions: [] } as any),
  ]);

  const dbcPositions: any[] =
    dbcDiscovery.status === 'fulfilled' ? dbcDiscovery.value.positions || [] : [];
  let dammPositions: any[] =
    dammDiscovery.status === 'fulfilled' ? dammDiscovery.value.positions || [] : [];

  const claimTasks: UniversalExitTask[] = [];
  const withdrawTasks: UniversalExitTask[] = [];

  if (includeDbc && dbcPositions.length) {
    const dbcBuilds = await Promise.allSettled(
      dbcPositions.map((p) =>
        postJson<{ txBase64?: string; tx?: string; lastValidBlockHeight: number }>(
          '/api/dbc-exit',
          {
            owner,
            dbcPoolKeys: { pool: p.pool, feeVault: p.feeVault },
            action: 'claim',
            priorityMicros,
            computeUnitLimit,
            // optional slippage forwarded; claim path ignores it server-side
            slippageBps,
          }
        ).then((built) => ({ p, built }))
      )
    );
    for (const res of dbcBuilds) {
      if (res.status === 'fulfilled') {
        const { p, built } = res.value as any;
        const txBase64 = built.txBase64 || built.tx; // tolerate either key
        if (!txBase64) {
          // eslint-disable-next-line no-console
          console.warn('[universal-exit] dbc build missing tx');
          continue;
        }
        claimTasks.push({
          protocol: 'dbc',
          kind: 'claim',
          pool: p.pool,
          feeVault: p.feeVault,
          tx: txBase64,
          lastValidBlockHeight: built.lastValidBlockHeight,
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          '[universal-exit] skip dbc position build failure',
          (res as any).reason?.message || (res as any).reason
        );
      }
    }
  }

  if (includeDamm) {
    // If discovery returned nothing, keep going — SDK wallet scan may still find positions.
    // Optional: restrict to migrated pools if env set
    const migratedList = (
      process.env.NEXT_PUBLIC_MIGRATED_DBC_POOLS ||
      process.env.MIGRATED_DBC_POOLS ||
      ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!migratedList.length) {
      // No env fence; proceed with wallet-derived discovery only.
      // eslint-disable-next-line no-console
      console.warn(
        '[universal-exit] MIGRATED_DBC_POOLS not set; relying on wallet-derived positions only'
      );
    }
    {
      const lower = new Set(migratedList.map((s) => s.toLowerCase()));
      // Prefer wallet discovery results; when MIGRATED_DBC_POOLS present, filter to migrated pools.
      const filtered = migratedList.length
        ? dammPositions.filter((p) => p.pool && lower.has(String(p.pool).toLowerCase()))
        : dammPositions;

      // Best-effort SDK build in browser; fallback to server API otherwise
      const isBrowser = typeof window !== 'undefined';
      let connection: Connection | null = null;
      let cp: CpAmm | null = null;
      let ownerPk: PublicKey | null = null;
      let latestBlockhash: { blockhash: string; lastValidBlockHeight: number } | null = null;
      let ownerPositions: any[] = [];

      if (isBrowser) {
        try {
          ownerPk = new PublicKey(owner);
          connection = new Connection(resolveRpc(), 'confirmed');
          cp = new CpAmm(connection);
          const helper: any =
            (cp as any).getAllPositionNftAccountByOwner || (cp as any).getAllUserPositionNftAccount;
          if (helper) {
            ownerPositions = await helper({ owner: ownerPk });
          }
          latestBlockhash = await connection.getLatestBlockhash('confirmed');
          // If server discovery was empty, synthesize positions from wallet scan (best-effort)
          if ((!dammPositions || dammPositions.length === 0) && Array.isArray(ownerPositions)) {
            dammPositions = ownerPositions
              .map((op: any) => ({
                pool:
                  (op.account?.pool || op.pool || op.account?.data?.pool)?.toBase58?.() ||
                  undefined,
                position: (op.publicKey || op.account?.publicKey)?.toBase58?.(),
                liquidity: op.account?.liquidity,
                hasNft: Boolean(
                  op.publicKey || op.account?.publicKey || op.account?.positionNftAccount
                ),
              }))
              .filter((p: any) => {
                if (!p.pool || !p.position) return false;
                const liq = p.liquidity;
                const positive =
                  liq?.isZero?.() === false ||
                  (typeof liq?.toString === 'function' && liq.toString() !== '0');
                return p.hasNft && positive;
              })
              .map((p: any) => ({ pool: p.pool, position: p.position }));
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(
            '[universal-exit] SDK init failed, will use server fallback',
            (e as any)?.message
          );
          connection = null;
          cp = null;
        }
      }

      // When we have ownerPositions (SDK discovery), further validate positions: require NFT and positive liquidity
      const filteredValidated = (() => {
        if (!Array.isArray(ownerPositions) || ownerPositions.length === 0) return filtered;
        const byPos = new Map<string, any>();
        for (const op of ownerPositions) {
          const pk = (op.publicKey || op.account?.publicKey)?.toBase58?.();
          if (!pk) continue;
          byPos.set(pk, op.account || op);
        }
        return filtered.filter((p: any) => {
          if (!p?.position) return false;
          const acct = byPos.get(String(p.position));
          if (!acct) return false;
          const liq = acct?.liquidity;
          const positive =
            liq?.isZero?.() === false ||
            (typeof liq?.toString === 'function' && liq.toString() !== '0');
          const hasNft = Boolean(acct?.positionNftAccount || acct?.publicKey);
          if (!hasNft || !positive) {
            // eslint-disable-next-line no-console
            console.warn(
              '[universal-exit] skipping position without NFT or liquidity > 0',
              p.position
            );
          }
          return hasNft && positive;
        });
      })();

      const builds = await Promise.allSettled(
        filteredValidated
          .filter((p) => p.pool)
          .map(async (p) => {
            // SDK path (browser only, when initialized successfully)
            if (connection && cp && ownerPk && latestBlockhash) {
              try {
                const poolPk = new PublicKey(p.pool);
                const positionPk = p.position ? new PublicKey(p.position) : null;
                const acct = ownerPositions.find(
                  (op) =>
                    (op.publicKey || op.account?.publicKey)?.toBase58?.() ===
                    positionPk?.toBase58?.()
                )?.account;
                if (!acct) throw new Error('position account not found in owner scan');

                const effSlippage = Number.isFinite(slippageBps as any)
                  ? Math.max(0, Math.min(Number(slippageBps), 10_000))
                  : 50; // default 50 bps

                // Compute thresholds via quote when available
                let tokenAAmountThreshold: any = 0;
                let tokenBAmountThreshold: any = 0;
                try {
                  const quoteFn: any = (cp as any).getWithdrawQuote;
                  const liquidity = acct.liquidity;
                  if (quoteFn && liquidity) {
                    const q = await quoteFn({
                      pool: poolPk,
                      position: positionPk || (acct.publicKey as PublicKey),
                      liquidityDelta: liquidity,
                      slippageBps: effSlippage,
                      owner: ownerPk,
                    });
                    tokenAAmountThreshold = q?.tokenAOut ?? q?.outAmountA ?? q?.amountA ?? 0;
                    tokenBAmountThreshold = q?.tokenBOut ?? q?.outAmountB ?? q?.amountB ?? 0;
                  }
                } catch {
                  // ignore quote failures
                }

                // Build remove-all if available; else removeLiquidity
                let txIxs: any[] | null = null;
                try {
                  if ((cp as any).removeAllLiquidity) {
                    const b = (cp as any).removeAllLiquidity({
                      owner: ownerPk,
                      position: positionPk || (acct.publicKey as PublicKey),
                      pool: poolPk,
                      positionNftAccount:
                        acct.positionNftAccount || positionPk || (acct.publicKey as PublicKey),
                      tokenAMint: acct.tokenAMint || acct.tokenA,
                      tokenBMint: acct.tokenBMint || acct.tokenB,
                      tokenAVault: acct.tokenAVault || acct.tokenAReserve || acct.vaultA,
                      tokenBVault: acct.tokenBVault || acct.tokenBReserve || acct.vaultB,
                      tokenAProgram: acct.tokenAProgram,
                      tokenBProgram: acct.tokenBProgram,
                      vestings: [],
                      currentPoint: acct.currentPoint || 0,
                      tokenAAmountThreshold:
                        tokenAAmountThreshold || acct.tokenAAmountThreshold || 0,
                      tokenBAmountThreshold:
                        tokenBAmountThreshold || acct.tokenBAmountThreshold || 0,
                    });
                    if (Array.isArray(b.ixs)) txIxs = b.ixs;
                    else if (b.build) {
                      const built = await b.build();
                      txIxs = Array.isArray(built) ? built : built?.instructions || null;
                    } else if (b.tx?.instructions) {
                      txIxs = b.tx.instructions;
                    }
                  } else if ((cp as any).removeLiquidity) {
                    const b = (cp as any).removeLiquidity({
                      owner: ownerPk,
                      position: positionPk || (acct.publicKey as PublicKey),
                      pool: poolPk,
                      positionNftAccount:
                        acct.positionNftAccount || positionPk || (acct.publicKey as PublicKey),
                      liquidityDelta: acct.liquidity,
                      tokenAAmountThreshold,
                      tokenBAmountThreshold,
                      tokenAMint: acct.tokenAMint || acct.tokenA,
                      tokenBMint: acct.tokenBMint || acct.tokenB,
                      tokenAVault: acct.tokenAVault || acct.tokenAReserve || acct.vaultA,
                      tokenBVault: acct.tokenBVault || acct.tokenBReserve || acct.vaultB,
                      tokenAProgram: acct.tokenAProgram,
                      tokenBProgram: acct.tokenBProgram,
                      vestings: [],
                      currentPoint: acct.currentPoint || 0,
                    });
                    if (Array.isArray(b.ixs)) txIxs = b.ixs;
                    else if (b.build) {
                      const built = await b.build();
                      txIxs = Array.isArray(built) ? built : built?.instructions || null;
                    } else if (b.tx?.instructions) {
                      txIxs = b.tx.instructions;
                    }
                  }
                } catch (e) {
                  throw new Error('sdk builder failed: ' + (e as any)?.message);
                }

                if (!txIxs || !txIxs.length) throw new Error('no instructions from sdk');

                // Build three escalating priority variants (base, +35%, +35%^2)
                const base = Math.max(0, Math.min(priorityMicros ?? 250_000, 3_000_000));
                const roundDownTo = (v: number, step: number) => Math.floor(v / step) * step;
                // First attempt: round base to nearest 1,000 (cap 3,000,000)
                const step1 = Math.min(roundDownTo(base, 1_000), 3_000_000);
                // Second attempt: exact +35% uplift without additional rounding to preserve 337,500 for a 250,000 base
                const step2Raw = base * 1.35;
                const step2 = Math.min(step2Raw, 3_000_000);
                // Third attempt: another +35% over the second, then rounded down to the nearest 1,000 and capped
                const step3 = Math.min(roundDownTo(step2 * 1.35, 1_000), 3_000_000);
                const steps = [step1, step2, step3];
                const variants = steps.map((micros) => {
                  const extras: any[] = [];
                  if (micros > 0)
                    extras.push(
                      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micros })
                    );
                  const msg = new TransactionMessage({
                    payerKey: ownerPk!,
                    recentBlockhash: latestBlockhash!.blockhash,
                    instructions: [...extras, ...txIxs!],
                  }).compileToV0Message();
                  const vtx = new VersionedTransaction(msg);
                  return {
                    tx: Buffer.from(vtx.serialize()).toString('base64'),
                    lastValidBlockHeight: latestBlockhash!.lastValidBlockHeight,
                    priorityMicros: micros,
                  };
                });
                return { p, built: variants[0], variants };
              } catch (e) {
                // SDK failed; fall through to server build
                // eslint-disable-next-line no-console
                console.warn(
                  '[universal-exit] SDK build failed, falling back to server',
                  (e as any)?.message
                );
              }
            }

            // Server fallback
            const base = Math.max(0, Math.min(priorityMicros ?? 250_000, 3_000_000));
            const roundDownTo = (v: number, step: number) => Math.floor(v / step) * step;
            const steps = [
              Math.min(roundDownTo(base, 1_000), 3_000_000),
              Math.min(base * 1.35, 3_000_000),
              Math.min(roundDownTo(base * 1.35 * 1.35, 1_000), 3_000_000),
            ];
            const variants = [] as Array<{
              tx: string;
              lastValidBlockHeight: number;
              priorityMicros: number;
            }>;
            for (const micros of steps) {
              const built = await postJson<{ tx: string; lastValidBlockHeight: number }>(
                '/api/dammv2-exit',
                {
                  owner,
                  pool: p.pool,
                  position: p.position,
                  percent: 100,
                  priorityMicros: micros,
                  slippageBps,
                }
              );
              variants.push({
                tx: built.tx,
                lastValidBlockHeight: built.lastValidBlockHeight,
                priorityMicros: micros,
              });
            }
            return { p, built: variants[0], variants };
          })
      );
      for (const res of builds) {
        if (res.status === 'fulfilled') {
          const { p, built, variants } = res.value as any;
          if (!built.tx) {
            // eslint-disable-next-line no-console
            console.warn('[universal-exit] dammv2 build missing tx');
            continue;
          }
          withdrawTasks.push({
            protocol: 'dammv2',
            kind: 'withdraw',
            pool: p.pool,
            position: p.position,
            tx: built.tx,
            lastValidBlockHeight: built.lastValidBlockHeight,
            priorityTxs: variants,
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            '[universal-exit] skip dammv2 position build failure',
            (res as any).reason?.message || (res as any).reason
          );
        }
      }
    }
  }

  // Order tasks per-pool: claim (dbc) before withdraw (dammv2)
  const byPool: Record<string, UniversalExitTask[]> = {};
  for (const t of [...claimTasks, ...withdrawTasks]) {
    const key = t.pool || 'unknown';
    if (!byPool[key]) byPool[key] = [];
    byPool[key].push(t);
  }
  const ordered: UniversalExitTask[] = [];
  for (const pool of Object.keys(byPool)) {
    const segment = byPool[pool];
    // simple stable partition: claims first
    ordered.push(...segment.filter((t) => t.kind === 'claim'));
    ordered.push(...segment.filter((t) => t.kind === 'withdraw'));
  }

  return ordered;
}

// Quick validator for base64 versioned transactions (throws if invalid)
export function validateSerializedTx(base64: string): void {
  try {
    VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  } catch (e) {
    throw new Error('Invalid serialized transaction: ' + (e as any)?.message);
  }
}
