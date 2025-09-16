import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  scanDbcPositionsUltraSafe,
  discoverMigratedDbcPoolsViaNfts,
  discoverMigratedDbcPoolsViaMetadata,
} from '@/server/dbc-adapter';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { owner: string };
    if (!body.owner) {
      return NextResponse.json({ error: 'owner required' }, { status: 400 });
    }
    const owner = new PublicKey(body.owner);

    const connection = new Connection(
      process.env.RPC_URL ||
        process.env.NEXT_PUBLIC_RPC_URL ||
        'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    // LP token + provisional pool scan
    const positions = await scanDbcPositionsUltraSafe({ connection, wallet: owner });

    // NFT-based pool discovery (runtime & metadata heuristics)
    const nftPools = await discoverMigratedDbcPoolsViaNfts({ connection, wallet: owner });
    const metaPools = await discoverMigratedDbcPoolsViaMetadata({ connection, wallet: owner });

    const nftPoolSet = [
      ...new Map([...nftPools, ...metaPools].map((p) => [p.toBase58(), p])).keys(),
    ];

    return NextResponse.json({
      positions: positions.map((p) => ({
        pool: p.poolKeys.pool.toBase58(),
        feeVault: p.poolKeys.feeVault.toBase58(),
        lpMint: p.poolKeys.lpMint.toBase58(),
        userLpToken: p.poolKeys.userLpToken.toBase58(),
        lpAmount: p.lpAmount.toString(),
        programId: p.programId.toBase58(),
      })),
      nftPools: nftPoolSet,
    });
  } catch (error) {
    console.error('[dbc-discover] error', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'internal error' },
      { status: 500 }
    );
  }
}
