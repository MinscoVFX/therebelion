import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

export const dynamic = 'force-dynamic';

interface ExitBody {
  owner?: string; // wallet base58
  position?: string; // position NFT (optional: if absent we auto-pick largest for pool)
  pool?: string; // pool address (required)
  percent?: number; // optional percent of liquidity to remove (default: 100)
  priorityMicros?: number; // optional priority fee (clamped)
  simulateOnly?: boolean; // optional simulation flag
  slippageBps?: number; // optional: reserved for future min-out thresholds
}

/**
 * Builds a DAMM v2 remove-liquidity transaction (best-effort) for a single position.
 * We intentionally keep minimal external quoting and rely on sdk's builder heuristics.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExitBody;
    if (!body.owner) return NextResponse.json({ error: 'owner required' }, { status: 400 });
    if (!body.pool) return NextResponse.json({ error: 'pool required' }, { status: 400 });

    const owner = new PublicKey(body.owner);
    const pool = new PublicKey(body.pool);
    const percent = typeof body.percent === 'number' ? body.percent : 100;
    if (percent <= 0 || percent > 100)
      return NextResponse.json({ error: 'percent must be (0,100]' }, { status: 400 });

    const connection = new Connection(
      process.env.RPC_URL ||
        process.env.NEXT_PUBLIC_RPC_URL ||
        'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    // Accept and clamp optional slippageBps for min-out thresholds when available
    const slippageBps = Number.isFinite((body as any).slippageBps as any)
      ? Math.max(0, Math.min(Number((body as any).slippageBps), 10_000))
      : undefined;

    const cp = new CpAmm(connection);
    const helper: any =
      (cp as any).getAllPositionNftAccountByOwner || (cp as any).getAllUserPositionNftAccount;
    if (!helper)
      return NextResponse.json({ error: 'sdk position helper missing' }, { status: 500 });

    let chosen: any | null = null;
    let allPositions: any[] = [];
    try {
      allPositions = await helper({ owner });
    } catch (e) {
      return NextResponse.json(
        { error: 'position scan failed', detail: (e as any)?.message },
        { status: 500 }
      );
    }

    const poolPositions = allPositions.filter(
      (p) => p.account?.pool?.toBase58?.() === pool.toBase58()
    );
    if (!poolPositions.length)
      return NextResponse.json({ error: 'no position for pool' }, { status: 404 });

    if (body.position) {
      const target = new PublicKey(body.position).toBase58();
      chosen = poolPositions.find(
        (p) => (p.publicKey || p.account?.publicKey)?.toBase58?.() === target
      );
      if (!chosen)
        return NextResponse.json(
          { error: 'specified position not found in pool' },
          { status: 404 }
        );
    } else {
      // pick largest liquidity
      poolPositions.sort((a, b) => {
        const la = a.account?.liquidity ?? { cmp: (_: any) => -1 };
        const lb = b.account?.liquidity ?? { cmp: (_: any) => -1 };
        // assume BN like objects with .cmp
        if (la.cmp && lb.cmp) return lb.cmp(la);
        return 0;
      });
      chosen = poolPositions[0];
    }

    const positionPk = (chosen.publicKey || chosen.account?.publicKey) as any; // PublicKey instance
    if (!positionPk)
      return NextResponse.json({ error: 'missing position public key' }, { status: 500 });

    // Determine liquidity fraction
    let liquidityDelta = chosen.account?.liquidity;
    if (!liquidityDelta)
      return NextResponse.json({ error: 'position liquidity unknown' }, { status: 500 });

    if (percent < 100) {
      try {
        // BN multiply/divide (duck-typed): liquidity * percent / 100
        liquidityDelta = liquidityDelta.mul(percent).div(100);
      } catch {
        // ignore and default to full
      }
    }

    // Optional min-out thresholds via withdraw quote (best-effort; ignored on failure)
    let tokenAAmountThreshold: any = 0;
    let tokenBAmountThreshold: any = 0;
    if (typeof slippageBps === 'number') {
      try {
        const quoteFn: any = (cp as any).getWithdrawQuote;
        if (quoteFn && liquidityDelta) {
          const q = await quoteFn({
            pool,
            position: positionPk,
            liquidityDelta,
            slippageBps,
            owner,
          });
          tokenAAmountThreshold = q?.tokenAOut ?? q?.outAmountA ?? q?.amountA ?? 0;
          tokenBAmountThreshold = q?.tokenBOut ?? q?.outAmountB ?? q?.amountB ?? 0;
        }
      } catch {
        // ignore quote failures
      }
    }

    // Attempt to build removeLiquidity route; fallback to removeAllLiquidity if easier.
    let txBuilder: any = null;
    try {
      if (percent === 100 && (cp as any).removeAllLiquidity) {
        txBuilder = (cp as any).removeAllLiquidity({
          owner,
          position: positionPk,
          pool,
          positionNftAccount: chosen.account?.positionNftAccount || positionPk,
          tokenAMint: chosen.account?.tokenAMint || chosen.account?.tokenA,
          tokenBMint: chosen.account?.tokenBMint || chosen.account?.tokenB,
          tokenAVault:
            chosen.account?.tokenAVault || chosen.account?.tokenAReserve || chosen.account?.vaultA,
          tokenBVault:
            chosen.account?.tokenBVault || chosen.account?.tokenBReserve || chosen.account?.vaultB,
          tokenAProgram: chosen.account?.tokenAProgram,
          tokenBProgram: chosen.account?.tokenBProgram,
          vestings: [],
          currentPoint: chosen.account?.currentPoint || 0,
          tokenAAmountThreshold:
            tokenAAmountThreshold || chosen.account?.tokenAAmountThreshold || 0,
          tokenBAmountThreshold:
            tokenBAmountThreshold || chosen.account?.tokenBAmountThreshold || 0,
        });
      } else if ((cp as any).removeLiquidity) {
        txBuilder = (cp as any).removeLiquidity({
          owner,
          position: positionPk,
          pool,
          positionNftAccount: chosen.account?.positionNftAccount || positionPk,
          liquidityDelta,
          tokenAAmountThreshold,
          tokenBAmountThreshold,
          tokenAMint: chosen.account?.tokenAMint || chosen.account?.tokenA,
          tokenBMint: chosen.account?.tokenBMint || chosen.account?.tokenB,
          tokenAVault:
            chosen.account?.tokenAVault || chosen.account?.tokenAReserve || chosen.account?.vaultA,
          tokenBVault:
            chosen.account?.tokenBVault || chosen.account?.tokenBReserve || chosen.account?.vaultB,
          tokenAProgram: chosen.account?.tokenAProgram,
          tokenBProgram: chosen.account?.tokenBProgram,
          vestings: [],
          currentPoint: chosen.account?.currentPoint || 0,
        });
      }
    } catch (e) {
      return NextResponse.json(
        { error: 'builder failed', detail: (e as any)?.message },
        { status: 500 }
      );
    }

    if (!txBuilder)
      return NextResponse.json(
        { error: 'no sdk removeLiquidity builder available' },
        { status: 500 }
      );

    // Extract instructions
    let ixs: any[] = [];
    try {
      if (Array.isArray(txBuilder.ixs)) ixs = txBuilder.ixs;
      else if (txBuilder.build) {
        const built = await txBuilder.build();
        if (Array.isArray(built)) ixs = built;
        else if (built?.instructions) ixs = built.instructions;
      } else if (txBuilder.tx?.instructions) {
        ixs = txBuilder.tx.instructions;
      }
    } catch (e) {
      return NextResponse.json(
        { error: 'extract instructions failed', detail: (e as any)?.message },
        { status: 500 }
      );
    }

    if (!ixs.length)
      return NextResponse.json({ error: 'no instructions produced' }, { status: 500 });

    const priorityMicros = Math.max(0, Math.min(body.priorityMicros ?? 250_000, 3_000_000));
    const extra: any[] = [];
    if (priorityMicros > 0)
      extra.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicros }));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: [...extra, ...ixs],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);

    if (body.simulateOnly) {
      const sim = await connection.simulateTransaction(tx, {
        commitment: 'confirmed',
        sigVerify: false,
      });
      return NextResponse.json({
        tx: Buffer.from(tx.serialize()).toString('base64'),
        lastValidBlockHeight,
        simulation: { logs: sim.value.logs, units: sim.value.unitsConsumed, err: sim.value.err },
      });
    }

    return NextResponse.json({
      tx: Buffer.from(tx.serialize()).toString('base64'),
      lastValidBlockHeight,
    });
  } catch (error) {
    console.error('[dammv2-exit] error', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'internal error' },
      { status: 500 }
    );
  }
}
