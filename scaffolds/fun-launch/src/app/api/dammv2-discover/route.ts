import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

export const dynamic = 'force-dynamic';

/**
 * Lists DAMM v2 user positions (best-effort) by scanning position NFT accounts via SDK helpers.
 * Response intentionally lean to feed universal exit planner.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { owner?: string };
    if (!body.owner) return NextResponse.json({ error: 'owner required' }, { status: 400 });
    const owner = new PublicKey(body.owner);

    const connection = new Connection(
      process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    const cp = new CpAmm(connection);
    // Prefer canonical helper; fall back if sdk shape changes.
    const helper: any = (cp as any).getAllPositionNftAccountByOwner || (cp as any).getAllUserPositionNftAccount;
    if (!helper) return NextResponse.json({ positions: [] });

    let rawPositions: any[] = [];
    try {
      rawPositions = await helper({ owner });
    } catch (e) {
      return NextResponse.json({ positions: [], warning: 'position scan failed', detail: (e as any)?.message });
    }

    const positions = rawPositions.map(p => {
      const acct = p.account || {}; // sdk dependent shape
      return {
        position: (p.publicKey || acct.publicKey)?.toBase58?.() || null,
        pool: acct.pool?.toBase58?.() || null,
        lpMint: acct.lpMint?.toBase58?.() || acct.lp_token_mint?.toBase58?.() || null,
        liquidity: acct.liquidity?.toString?.() || null,
      };
    }).filter(p => p.position && p.pool);

    return NextResponse.json({ positions });
  } catch (error) {
    console.error('[dammv2-discover] error', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'internal error' }, { status: 500 });
  }
}
