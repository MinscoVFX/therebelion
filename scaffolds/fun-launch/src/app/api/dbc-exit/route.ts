import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { resolveRpc } from '@/lib/rpc';
import {
  buildDbcExitTransaction,
  getClaimDiscriminatorMeta,
  getActiveClaimDiscriminatorHex,
  getWithdrawDiscriminatorMeta,
  getActiveWithdrawDiscriminatorHex,
} from '../../../server/dbc-exit-builder';

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const qpAction = (url.searchParams.get('action') || '').toLowerCase();
    const body = (await req.json().catch(() => ({}) as any)) as any;
    const action = (body.action || qpAction || 'claim').toLowerCase();
    const simulateOnly =
      body.simulateOnly === true ||
      url.searchParams.get('simulateOnly') === '1' ||
      url.searchParams.get('simulateOnly') === 'true';

    // Validate minimal fields; claim & combined require feeVault; withdraw only needs pool.
    if (
      !body.owner ||
      !body.dbcPoolKeys?.pool ||
      ((action === 'claim' || action === 'claim_and_withdraw') && !body.dbcPoolKeys?.feeVault)
    ) {
      if (simulateOnly) {
        return NextResponse.json({
          simulated: true,
          stub: true,
          logs: [],
          unitsConsumed: 0,
          txBase64: '',
          warning: 'simulateOnly stub returned due to missing required fields',
        });
      }
      return NextResponse.json(
        {
          error:
            'Missing required fields: owner, dbcPoolKeys.pool' +
            (action === 'claim' || action === 'claim_and_withdraw' ? ', dbcPoolKeys.feeVault' : ''),
        },
        { status: 400 }
      );
    }

    const connection = new Connection(resolveRpc(), 'confirmed');

    const built = await buildDbcExitTransaction(connection, {
      owner: body.owner,
      dbcPoolKeys: body.dbcPoolKeys,
      action,
      priorityMicros: body.priorityMicros,
      slippageBps: body.slippageBps,
      computeUnitLimit: body.computeUnitLimit,
      simulateOnly,
    });

    const base64 = Buffer.from(built.tx.serialize()).toString('base64');
    const metas = [] as any[];
    if (action === 'claim') {
      const m = getClaimDiscriminatorMeta();
      metas.push({
        type: 'claim',
        discriminator: getActiveClaimDiscriminatorHex(),
        source: m?.source,
        instructionName: m?.instructionName,
      });
    } else if (action === 'withdraw') {
      const m = getWithdrawDiscriminatorMeta();
      metas.push({
        type: 'withdraw',
        discriminator: getActiveWithdrawDiscriminatorHex(),
        source: m?.source,
        instructionName: m?.instructionName,
      });
    } else if (action === 'claim_and_withdraw') {
      const mc = getClaimDiscriminatorMeta();
      const mw = getWithdrawDiscriminatorMeta();
      metas.push({
        type: 'claim',
        discriminator: getActiveClaimDiscriminatorHex(),
        source: mc?.source,
        instructionName: mc?.instructionName,
      });
      metas.push({
        type: 'withdraw',
        discriminator: getActiveWithdrawDiscriminatorHex(),
        source: mw?.source,
        instructionName: mw?.instructionName,
      });
    }
    const common = {
      instructions: metas,
      lastValidBlockHeight: built.lastValidBlockHeight,
    };
    if (built.simulation) {
      return NextResponse.json({
        simulated: true,
        logs: built.simulation.logs,
        unitsConsumed: built.simulation.unitsConsumed,
        error: built.simulation.error,
        txBase64: base64,
        ...common,
      });
    }
    return NextResponse.json({
      simulated: false,
      txBase64: base64,
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = (searchParams.get('action') || 'claim').toLowerCase();
  const simulateOnly =
    searchParams.get('simulateOnly') === '1' || searchParams.get('simulateOnly') === 'true';

  if (action === 'withdraw') {
    return new Response(
      JSON.stringify({ error: 'withdraw is intentionally disabled (claim-only)' }),
      { status: 501, headers: { 'content-type': 'application/json' } }
    );
  }
  // Delegate GET to POST to reuse logic
  const delegated = new Request(req.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'claim', simulateOnly }),
  });
  return POST(delegated);
}
