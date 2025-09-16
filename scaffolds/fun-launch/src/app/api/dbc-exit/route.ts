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
    let action = (body.action || qpAction || 'claim').toLowerCase();
    const originalRequestedAction = action; // keep track for fallback metadata
    const simulateOnly =
      body.simulateOnly === true ||
      url.searchParams.get('simulateOnly') === '1' ||
      url.searchParams.get('simulateOnly') === 'true';

    // NEW: positionMint support (ready for builder interface update)
    // let positionMint: PublicKey | undefined
    // if (typeof body.positionMint === 'string') {
    //   try { positionMint = new PublicKey(body.positionMint) } catch {}
    // }

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

    // Withdraw-first fallback logic: if client or query requests 'withdraw_first' (or plain 'withdraw')
    // we attempt withdraw; on a controlled failure we degrade to claim to avoid user friction.
    // Accept synonyms: 'withdraw_first', 'prefer_withdraw'.
    const withdrawPreferred = ['withdraw_first', 'prefer_withdraw'].includes(originalRequestedAction);
    if (withdrawPreferred) {
      action = 'withdraw';
    }

    let built;
    let fallbackTriggered: undefined | {
      from: string;
      to: string;
      reason: string;
    };
    try {
      built = await buildDbcExitTransaction(connection, {
        owner: body.owner,
        dbcPoolKeys: body.dbcPoolKeys,
        action,
        priorityMicros: body.priorityMicros,
        slippageBps: body.slippageBps,
        computeUnitLimit: body.computeUnitLimit,
        simulateOnly,
      });
    } catch (withdrawErr) {
      // Only fallback if withdraw was attempted & claim is viable
      if ((action === 'withdraw' || action === 'claim_and_withdraw') && !simulateOnly) {
        // Basic heuristics: program error, missing discriminator, or explicit marker from builder.
        const msg = withdrawErr instanceof Error ? withdrawErr.message : String(withdrawErr);
        const isRecoverable = /discriminator|instruction|withdraw|not supported|Program failed/i.test(msg);
        if (isRecoverable) {
          try {
            action = 'claim';
            built = await buildDbcExitTransaction(connection, {
              owner: body.owner,
              dbcPoolKeys: body.dbcPoolKeys,
              action: 'claim',
              priorityMicros: body.priorityMicros,
              slippageBps: body.slippageBps,
              computeUnitLimit: body.computeUnitLimit,
              simulateOnly,
            });
            fallbackTriggered = { from: 'withdraw', to: 'claim', reason: msg.slice(0, 280) };
          } catch (claimErr) {
            // If claim also fails, rethrow original withdraw error context + claim failure snippet
            const cmsg = claimErr instanceof Error ? claimErr.message : String(claimErr);
            throw new Error(`Withdraw attempt failed (${msg}); claim fallback also failed (${cmsg})`);
          }
        } else {
          throw withdrawErr;
        }
      } else {
        throw withdrawErr;
      }
    }

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
      requestedAction: originalRequestedAction,
      effectiveAction: action,
      fallback: fallbackTriggered,
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
