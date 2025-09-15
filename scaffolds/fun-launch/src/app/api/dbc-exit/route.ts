import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { buildDbcExitTransaction } from '@/server/dbc-exit-builder';
import { loadDbcIdl, getClaimIxNameFromIdl, deriveAnchorDiscriminator } from '@/lib/dbc/idl';

export const runtime = 'nodejs';

interface DiscriminatorResolution {
  discriminator: Buffer;
  source: string;
  instructionName?: string;
}

function resolveClaimDiscriminatorStrict(): DiscriminatorResolution {
  // 1. Explicit hex env (authoritative)
  const hex = process.env.DBC_CLAIM_FEE_DISCRIMINATOR?.replace(/^0x/, '');
  if (hex) {
    if (hex.length !== 16) throw new Error('DBC_CLAIM_FEE_DISCRIMINATOR must be 16 hex chars (8 bytes)');
    return { discriminator: Buffer.from(hex, 'hex'), source: 'env_hex' };
  }
  // 2. Explicit instruction name env
  if (process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME) {
    const name = process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME.trim();
    const disc = deriveAnchorDiscriminator(name);
    return { discriminator: disc, source: 'env_name', instructionName: name };
  }
  // 3. IDL path if enabled
  if (process.env.DBC_USE_IDL === 'true') {
    const idl = loadDbcIdl();
    if (idl) {
      const ixName = getClaimIxNameFromIdl(idl);
      if (ixName) {
        const disc = deriveAnchorDiscriminator(ixName);
        return { discriminator: disc, source: 'idl', instructionName: ixName };
      }
    }
  }
  // 4. No placeholder allowed in production
  if (process.env.NODE_ENV === 'production') {
    throw new Error('No DBC claim fee discriminator could be resolved. Provide DBC_CLAIM_FEE_DISCRIMINATOR (hex), DBC_CLAIM_FEE_INSTRUCTION_NAME, or enable DBC_USE_IDL with a valid dbc_idl.json');
  }
  // Dev only: emit warning and allow placeholder so local UI can still render.
  // eslint-disable-next-line no-console
  console.warn('[dbc-exit] Dev fallback: using placeholder discriminator (NOT allowed in production)');
  return { discriminator: Buffer.from('0102030405060708', 'hex'), source: 'placeholder' };
}

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

    const connection = new Connection(
      process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    const action = (body.action || 'claim') as string;
    if (action === 'withdraw') {
      return NextResponse.json({ error: 'Withdraw is disabled until official DBC withdraw instruction is integrated', code: 'NOT_IMPLEMENTED' }, { status: 501 });
    }

    let discriminatorInfo: DiscriminatorResolution | null = null;
    try {
      discriminatorInfo = resolveClaimDiscriminatorStrict();
    } catch (e) {
      if (process.env.NODE_ENV === 'production') throw e; // hard fail prod
      // Dev mode: surface as warning
      // eslint-disable-next-line no-console
      console.warn('[dbc-exit] discriminator resolution failed:', e);
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }

    const built = await buildDbcExitTransaction(connection, {
      owner: body.owner,
      dbcPoolKeys: body.dbcPoolKeys,
      action: 'claim', // force claim only
      priorityMicros: body.priorityMicros,
      slippageBps: body.slippageBps,
      computeUnitLimit: body.computeUnitLimit,
      simulateOnly: body.simulateOnly || body.simulateOnly === 1 || body.simulateOnly === '1',
      claimDiscriminator: discriminatorInfo.discriminator,
    });

    const base64 = Buffer.from(built.tx.serialize()).toString('base64');
    const discHex = discriminatorInfo.discriminator.toString('hex');
    const common = {
      discriminator: discHex,
      discriminatorSource: discriminatorInfo.source,
      discriminatorInstructionName: discriminatorInfo.instructionName,
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
