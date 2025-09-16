import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { resolveRpc } from '../../../lib/rpc';
import { buildDbcExitTransaction } from '../../../server/dbc-exit-builder';
import {
  scanDbcPositionsUltraSafe,
  discoverMigratedDbcPoolsViaNfts,
  discoverMigratedDbcPoolsViaMetadata,
} from '../../../server/dbc-adapter';

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

    // Auto-discover DBC positions using multiple methods
    console.log(`[DBC One-Click Exit] Discovering positions for: ${owner.toBase58()}`);

    const [lpPositions, nftPositions, metadataPositions] = await Promise.all([
      scanDbcPositionsUltraSafe({ connection, wallet: owner }),
      discoverMigratedDbcPoolsViaNfts({ connection, wallet: owner }),
      discoverMigratedDbcPoolsViaMetadata({ connection, wallet: owner }),
    ]);

    console.log(`[DBC One-Click Exit] Discovery results:`);
    console.log(`- LP Positions: ${lpPositions?.length || 0}`);
    console.log(`- NFT Positions: ${nftPositions?.length || 0}`);
    console.log(`- Metadata Positions: ${metadataPositions?.length || 0}`);

    // Use LP positions for building transactions (NFT positions need different handling)
    const positions = lpPositions || [];
    const totalPositionsFound =
      positions.length + (nftPositions?.length || 0) + (metadataPositions?.length || 0);

    if (positions.length === 0) {
      // Get token accounts for debugging
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      });

      const nonZeroTokens = tokenAccounts.value.filter(({ account }) => {
        const info: any = (account.data as any)?.parsed?.info;
        return info?.tokenAmount?.amount !== '0';
      });

      return NextResponse.json(
        {
          error: 'No DBC positions found for this wallet',
          debug: {
            wallet: owner.toBase58(),
            totalTokenAccounts: tokenAccounts.value.length,
            nonZeroTokenAccounts: nonZeroTokens.length,
            lpPositions: positions.length,
            nftPositions: nftPositions?.length || 0,
            metadataPositions: metadataPositions?.length || 0,
            totalPositionsFound,
            checkedPrograms: [
              'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
              'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
            ],
            hint: 'DBC positions require LP tokens from participating in bonding curve pools, or NFTs from migrated DAMM v2 pools',
          },
        },
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
      totalPositions: totalPositionsFound,
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
