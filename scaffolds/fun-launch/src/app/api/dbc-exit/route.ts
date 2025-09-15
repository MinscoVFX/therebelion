import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { resolveRpc } from '@/lib/rpc';
import { buildDbcExitTransaction, getClaimDiscriminatorMeta, getActiveClaimDiscriminatorHex } from '@/server/dbc-exit-builder';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as any; // runtime validation below

    // Validate required fields
    if (!body.owner || !body.dbcPoolKeys?.pool || !body.dbcPoolKeys?.feeVault) {
      return NextResponse.json(
        { error: 'Missing required fields: owner, dbcPoolKeys.pool, dbcPoolKeys.feeVault' },
        { status: 400 }
      );
    }

    if (body.action === 'withdraw') {
      return NextResponse.json({ error: 'Withdraw disabled: claim-only mode active' }, { status: 501 });
    }

    const connection = new Connection(resolveRpc(), 'confirmed');

    const built = await buildDbcExitTransaction(connection, {
      owner: body.owner,
      dbcPoolKeys: body.dbcPoolKeys,
      action: body.action, // default handled inside builder
      priorityMicros: body.priorityMicros,
      slippageBps: body.slippageBps,
      computeUnitLimit: body.computeUnitLimit,
      simulateOnly: body.simulateOnly,
    });

    const base64 = Buffer.from(built.tx.serialize()).toString('base64');
    const discMeta = getClaimDiscriminatorMeta();
    const discHex = getActiveClaimDiscriminatorHex();
    const common = {
      discriminator: discHex,
      discriminatorSource: discMeta?.source,
      discriminatorInstructionName: discMeta?.instructionName,
      lastValidBlockHeight: built.lastValidBlockHeight,
    };
    if (built.simulation) {
      return NextResponse.json({
        simulated: true,
        logs: built.simulation.logs,
        unitsConsumed: built.simulation.unitsConsumed,
        error: built.simulation.error,
        tx: base64,
        ...common,
      });
    }
    return NextResponse.json({
      simulated: false,
      tx: base64,
      ...common,
    });
  } catch (error) {
    console.error('DBC exit API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
