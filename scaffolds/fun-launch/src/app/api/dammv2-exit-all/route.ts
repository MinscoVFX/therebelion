import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { resolveRpc } from '../../../lib/rpc';

export const dynamic = 'force-dynamic';

interface ExitAllBody {
  owner?: string; // wallet base58
  migratedOnly?: boolean; // if true, restrict to pools in MIGRATED_DBC_POOLS env var (comma-separated list)
  priorityMicros?: number; // optional priority fee per tx (micro lamports)
  simulateOnly?: boolean; // if true, simulate instead of returning executable txs
  maxPerTx?: number; // optional future packing (currently one position per tx)
}

/**
 * Builds full-liquidity removal transactions for ALL (or migrated) DAMM v2 positions owned by a wallet.
 * Fast path: one position => single tx. Multiple positions => array of txs (one per position for reliability).
 * Design goal: zero additional user config. If migratedOnly = true we read MIGRATED_DBC_POOLS env (comma separated pool addresses).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExitAllBody;
    if (!body.owner) return NextResponse.json({ error: 'owner required' }, { status: 400 });
    const owner = new PublicKey(body.owner);

    const connection = new Connection(resolveRpc(), 'confirmed');

  // Dynamic import so monkey-patched CpAmm in tests is respected
  const { CpAmm } = await import('@meteora-ag/cp-amm-sdk');
  const cp = new CpAmm(connection);
    const helper: any = (cp as any).getAllPositionNftAccountByOwner || (cp as any).getAllUserPositionNftAccount;
    if (!helper) return NextResponse.json({ error: 'sdk position helper missing' }, { status: 500 });

    let rawPositions: any[] = [];
    try {
      rawPositions = await helper({ owner });
    } catch (e) {
      return NextResponse.json({ error: 'position scan failed', detail: (e as any)?.message }, { status: 500 });
    }

    // Normalize
    const positions = rawPositions
      .map((p) => ({
        raw: p,
        positionPk: (p.publicKey || p.account?.publicKey) as PublicKey | undefined,
        pool: p.account?.pool as PublicKey | undefined,
        liquidity: p.account?.liquidity,
      }))
      .filter((p) => p.positionPk && p.pool);

    if (!positions.length) return NextResponse.json({ positions: [], txs: [] });

    // Migrated filter (env list) — minimal initial implementation. Future: auto-detect via DBC metadata PDA.
    let filtered = positions;
    if (body.migratedOnly) {
      const migratedList = (process.env.MIGRATED_DBC_POOLS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!migratedList.length) {
        return NextResponse.json(
          {
            error: 'migratedOnly requested but MIGRATED_DBC_POOLS env variable not configured',
          },
          { status: 400 }
        );
      }
      filtered = filtered.filter((p) => migratedList.includes(p.pool!.toBase58()));
    }

    if (!filtered.length) return NextResponse.json({ positions: [], txs: [] });

    const priorityMicros = Math.max(0, Math.min(body.priorityMicros ?? 250_000, 3_000_000));

  const results: { position: string; pool: string; status: string; reason?: string }[] = [];
    const txs: string[] = [];
    const simulations: any[] = [];

    // Reuse one recent blockhash (simplifies signing) – still valid for a short batch window.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    for (const entry of filtered) {
      const positionBase58 = entry.positionPk!.toBase58();
      const poolBase58 = entry.pool!.toBase58();

      // Pre-classify skip reasons before any heavy builder logic so tests can reliably assert.
      const acctOwner = (entry.raw.account?.owner || entry.raw.account?.authority || entry.raw.account?.positionOwner);
      const ownerMismatch = acctOwner && acctOwner.toBase58 && acctOwner.toBase58() !== owner.toBase58();
      const vestingsArr = entry.raw.account?.vestings || entry.raw.account?.lockedVestings;
      const hasLocked = Array.isArray(vestingsArr) && vestingsArr.length > 0;
      if (hasLocked) {
        results.push({ position: positionBase58, pool: poolBase58, status: 'skipped', reason: 'locked-vesting' });
        // still continue to next position
        continue;
      }
      if (ownerMismatch) {
        results.push({ position: positionBase58, pool: poolBase58, status: 'skipped', reason: 'owner-mismatch' });
        continue;
      }

      if (!entry.liquidity || (entry.liquidity.cmp && entry.liquidity.cmp(new (entry.liquidity.constructor)(0)) === 0)) {
        results.push({ position: positionBase58, pool: poolBase58, status: 'skipped', reason: 'zero-liquidity' });
        continue;
      }

      let builder: any = null;
      try {
        // Prefer removeAllLiquidity path when available.
        if ((cp as any).removeAllLiquidity) {
          builder = (cp as any).removeAllLiquidity({
            owner,
            position: entry.positionPk,
            pool: entry.pool,
            positionNftAccount: entry.raw.account?.positionNftAccount || entry.positionPk,
            tokenAMint: entry.raw.account?.tokenAMint || entry.raw.account?.tokenA,
            tokenBMint: entry.raw.account?.tokenBMint || entry.raw.account?.tokenB,
            tokenAVault: entry.raw.account?.tokenAVault || entry.raw.account?.tokenAReserve || entry.raw.account?.vaultA,
            tokenBVault: entry.raw.account?.tokenBVault || entry.raw.account?.tokenBReserve || entry.raw.account?.vaultB,
            tokenAProgram: entry.raw.account?.tokenAProgram,
            tokenBProgram: entry.raw.account?.tokenBProgram,
            vestings: [],
            currentPoint: entry.raw.account?.currentPoint || 0,
            tokenAAmountThreshold: entry.raw.account?.tokenAAmountThreshold || 0,
            tokenBAmountThreshold: entry.raw.account?.tokenBAmountThreshold || 0,
          });
        } else if ((cp as any).removeLiquidity) {
          builder = (cp as any).removeLiquidity({
            owner,
            position: entry.positionPk,
            pool: entry.pool,
            positionNftAccount: entry.raw.account?.positionNftAccount || entry.positionPk,
            liquidityDelta: entry.liquidity, // full amount
            tokenAAmountThreshold: 0,
            tokenBAmountThreshold: 0,
            tokenAMint: entry.raw.account?.tokenAMint || entry.raw.account?.tokenA,
            tokenBMint: entry.raw.account?.tokenBMint || entry.raw.account?.tokenB,
            tokenAVault: entry.raw.account?.tokenAVault || entry.raw.account?.tokenAReserve || entry.raw.account?.vaultA,
            tokenBVault: entry.raw.account?.tokenBVault || entry.raw.account?.tokenBReserve || entry.raw.account?.vaultB,
            tokenAProgram: entry.raw.account?.tokenAProgram,
            tokenBProgram: entry.raw.account?.tokenBProgram,
            vestings: [],
            currentPoint: entry.raw.account?.currentPoint || 0,
          });
        } else {
          results.push({ position: positionBase58, pool: poolBase58, status: 'skipped', reason: 'no-builder' });
          continue;
        }
      } catch (e: any) {
        results.push({
          position: positionBase58,
          pool: poolBase58,
          status: 'skipped',
          reason: `builder-failed:${e?.message || 'unknown'}`,
        });
        continue;
      }

      // Extract instructions
      let ixs: any[] = [];
      try {
        if (Array.isArray(builder.ixs)) ixs = builder.ixs;
        else if (builder.build) {
          const built = await builder.build();
            // built can be array or object
          if (Array.isArray(built)) ixs = built;
          else if (built?.instructions) ixs = built.instructions;
        } else if (builder.tx?.instructions) {
          ixs = builder.tx.instructions;
        }
      } catch (e: any) {
        results.push({
          position: positionBase58,
          pool: poolBase58,
          status: 'skipped',
          reason: `extract-failed:${e?.message || 'unknown'}`,
        });
        continue;
      }

      if (!ixs.length) {
        results.push({ position: positionBase58, pool: poolBase58, status: 'skipped', reason: 'empty-instructions' });
        continue;
      }

      const extra: any[] = [];
      if (priorityMicros > 0) {
        extra.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicros }));
      }

      const msg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions: [...extra, ...ixs],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);

      if (body.simulateOnly) {
        const sim = await connection.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: false });
        simulations.push({
          position: positionBase58,
            logs: sim.value.logs,
            units: sim.value.unitsConsumed,
            err: sim.value.err || null,
        });
        if (sim.value.err) {
          results.push({ position: positionBase58, pool: poolBase58, status: 'skipped', reason: 'simulation-error' });
          continue;
        }
      }

      txs.push(Buffer.from(tx.serialize()).toString('base64'));
      results.push({ position: positionBase58, pool: poolBase58, status: 'built' });
    }

    if (body.simulateOnly) {
      return NextResponse.json({
        simulateOnly: true,
        positions: results,
        simulations,
        txs, // still include successful ones (base64)
        lastValidBlockHeight,
      });
    }

    return NextResponse.json({ positions: results, txs, lastValidBlockHeight });
  } catch (error) {
    console.error('[dammv2-exit-all] error', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
  }
}
