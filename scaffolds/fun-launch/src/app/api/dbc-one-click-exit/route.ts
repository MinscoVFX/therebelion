import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { resolveRpc } from '../../../lib/rpc';
import { buildDbcExitTransaction } from '../../../server/dbc-exit-builder';

/**
 * DBC One-Click Exit - Combines fee claiming and liquidity withdrawal
 * Replicates the functionality from the Meteora website transaction
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      ownerPubkey,
      dbcPoolKeys,
      priorityMicros = 250_000,
      computeUnitLimit = 400_000,
      slippageBps = 100, // 1% slippage tolerance
    } = body;

    if (!ownerPubkey) {
      return NextResponse.json({ error: 'Missing ownerPubkey' }, { status: 400 });
    }
    if (!dbcPoolKeys?.pool) {
      return NextResponse.json({ error: 'Missing dbcPoolKeys.pool' }, { status: 400 });
    }
    if (!dbcPoolKeys?.feeVault) {
      return NextResponse.json({ error: 'Missing dbcPoolKeys.feeVault' }, { status: 400 });
    }

    const connection = new Connection(resolveRpc(), 'confirmed');

    // Build combined claim and withdraw transaction (like Meteora website)
    const combinedTx = await buildDbcExitTransaction(connection, {
      owner: ownerPubkey,
      dbcPoolKeys,
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
      description: 'Combined DBC fee claim and liquidity withdrawal',
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
