export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { resolveRpc } from '@/lib/rpc';
import {
  scanDbcPositionsUltraSafe,
  discoverMigratedDbcPoolsViaMetadata,
  discoverMigratedDbcPoolsViaNfts,
} from '@/server/dbc-adapter';

const NO_STORE_HEADER = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const walletParam = (url.searchParams.get('wallet') || '').trim();

  if (!walletParam) {
    return NextResponse.json({ error: 'wallet missing' }, { status: 400, headers: NO_STORE_HEADER });
  }

  let owner: PublicKey;
  try {
    owner = new PublicKey(walletParam);
  } catch (err) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400, headers: NO_STORE_HEADER });
  }

  try {
    const connection = new Connection(resolveRpc(), 'confirmed');

    const [positions, runtimePools, metadataPools] = await Promise.all([
      scanDbcPositionsUltraSafe({ connection, wallet: owner }),
      discoverMigratedDbcPoolsViaNfts({ connection, wallet: owner }),
      discoverMigratedDbcPoolsViaMetadata({ connection, wallet: owner }),
    ]);

    const sanitizedPositions = positions.map((pos) => ({
      programId: pos.programId.toBase58(),
      lpAmount: pos.lpAmount.toString(),
      estimatedValueUsd: typeof pos.estimatedValueUsd === 'number' ? pos.estimatedValueUsd : null,
      poolKeys: {
        pool: pos.poolKeys.pool.toBase58(),
        feeVault: pos.poolKeys.feeVault.toBase58(),
        tokenA: pos.poolKeys.tokenA ? pos.poolKeys.tokenA.toBase58() : null,
        tokenB: pos.poolKeys.tokenB ? pos.poolKeys.tokenB.toBase58() : null,
        lpMint: pos.poolKeys.lpMint ? pos.poolKeys.lpMint.toBase58() : null,
        userLpToken: pos.poolKeys.userLpToken ? pos.poolKeys.userLpToken.toBase58() : null,
        userTokenA: pos.poolKeys.userTokenA ? pos.poolKeys.userTokenA.toBase58() : null,
        userTokenB: pos.poolKeys.userTokenB ? pos.poolKeys.userTokenB.toBase58() : null,
      },
    }));

    const dedupedRuntime = Array.from(new Set(runtimePools.map((pk) => pk.toBase58())));
    const dedupedMetadata = Array.from(new Set(metadataPools.map((pk) => pk.toBase58())));

    return NextResponse.json(
      {
        wallet: owner.toBase58(),
        positions: sanitizedPositions,
        nftPools: {
          runtime: dedupedRuntime,
          metadata: dedupedMetadata,
        },
      },
      { headers: NO_STORE_HEADER }
    );
  } catch (err) {
    console.error('[api/exit-tools] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: NO_STORE_HEADER }
    );
  }
}
