import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { resolveRpc } from '../../../lib/rpc';
import { buildDbcExitTransaction } from '../../../server/dbc-exit-builder';
import { scanDbcPositionsUltraSafe } from '../../../server/dbc-adapter';

/**
 * DBC One-Click Exit - Combines fee claiming and liquidity withdrawal
 * Auto-discovers the user's biggest DBC pool and creates a combined transaction
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      ownerPubkey,
      priorityMicros = 250_000,
      computeUnitLimit = 400_000,
      slippageBps = 100, // 1% slippage tolerance
    } = body;

    if (!ownerPubkey) {
      return NextResponse.json({ error: 'Missing ownerPubkey' }, { status: 400 });
    }

    const connection = new Connection(resolveRpc(), 'confirmed');
    const owner = new PublicKey(ownerPubkey);

    // Auto-discover DBC positions
    const positions = await scanDbcPositionsUltraSafe({ connection, wallet: owner });

    if (!positions || positions.length === 0) {
      return NextResponse.json(
        { error: 'No DBC positions found for this wallet' },
        { status: 404 }
      );
    }

    // Find the position with the largest LP amount (biggest pool)
    const selectedPosition = positions.reduce((acc, p) =>
      !acc || p.lpAmount > acc.lpAmount ? p : acc
    );

    const dbcPoolKeys = {
      pool: selectedPosition.poolKeys.pool.toBase58(),
      feeVault: selectedPosition.poolKeys.feeVault.toBase58(),
    };

    // Build combined claim and withdraw transaction (like Meteora website)
    const combinedTx = await buildDbcExitTransaction(connection, {
      owner: ownerPubkey,
      dbcPoolKeys: {
        pool: selectedPosition.poolKeys.pool.toBase58(),
        feeVault: selectedPosition.poolKeys.feeVault.toBase58(),
      },
      action: 'claim_and_withdraw',
      priorityMicros,
      slippageBps,
      computeUnitLimit,
      simulateOnly: false,
    });

    const txBase64 = Buffer.from(combinedTx.tx.serialize()).toString('base64');

    return NextResponse.json({
      success: true,
      tx: txBase64,
      lastValidBlockHeight: combinedTx.lastValidBlockHeight,
      description: 'Combined DBC fee claim and liquidity withdrawal (auto-discovered)',
      selectedPool: dbcPoolKeys,
      totalPositions: positions.length,
      actions: ['claim_trading_fees', 'withdraw_liquidity'],
      priorityMicrosUsed: priorityMicros,
      computeUnitLimit,
      slippageBps,
    });
  } catch (e: any) {
    console.error('[api/dbc-one-click-exit] error:', e);
    return NextResponse.json(
      { error: e?.message || 'Failed to build one-click exit transaction' },
      { status: 500 }
    );
  }
}
