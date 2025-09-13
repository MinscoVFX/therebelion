import type { NextApiRequest, NextApiResponse } from 'next';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  TransactionInstruction,
} from '@solana/web3.js';

import { buildDbcClaimTradingFeeIx, type DbcPoolKeys } from '@/server/dbc-adapter';
import { buildDammV2RemoveAllLpIxs, type DammV2PoolKeys } from '@/server/dammv2-adapter';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

function parseDbcPoolKeys(raw: any): DbcPoolKeys {
  return {
    pool: new PublicKey(raw.pool),
    feeVault: new PublicKey(raw.feeVault),
  };
}

function parseDammV2PoolKeys(raw: any): DammV2PoolKeys {
  return {
    programId: new PublicKey(raw.programId),
    pool: new PublicKey(raw.pool),
    lpMint: new PublicKey(raw.lpMint),
    tokenAMint: new PublicKey(raw.tokenAMint),
    tokenBMint: new PublicKey(raw.tokenBMint),
    tokenAVault: new PublicKey(raw.tokenAVault),
    tokenBVault: new PublicKey(raw.tokenBVault),
    authorityPda: new PublicKey(raw.authorityPda),
  };
}

/**
 * POST /api/dbc-one-click-exit
 * Body:
 * {
 *   "ownerPubkey": "<string>",
 *   "dbcPoolKeys": { "pool": "<string>", "feeVault": "<string>" },
 *   "includeDammV2Exit": true|false,
 *   "dammV2PoolKeys": {
 *      "programId": "<string>", "pool": "<string>", "lpMint": "<string>",
 *      "tokenAMint": "<string>", "tokenBMint": "<string>",
 *      "tokenAVault": "<string>", "tokenBVault": "<string>",
 *      "authorityPda": "<string>"
 *   },
 *   "priorityMicros": 250000
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

    const {
      ownerPubkey,
      dbcPoolKeys,
      includeDammV2Exit = false,
      dammV2PoolKeys,
      priorityMicros = 250_000,
    } = req.body as {
      ownerPubkey: string;
      dbcPoolKeys: { pool: string; feeVault: string };
      includeDammV2Exit?: boolean;
      dammV2PoolKeys?: {
        programId: string;
        pool: string;
        lpMint: string;
        tokenAMint: string;
        tokenBMint: string;
        tokenAVault: string;
        tokenBVault: string;
        authorityPda: string;
      };
      priorityMicros?: number;
    };

    if (!ownerPubkey) return res.status(400).json({ error: 'Missing ownerPubkey' });
    if (!dbcPoolKeys) return res.status(400).json({ error: 'Missing dbcPoolKeys' });

    const owner = new PublicKey(ownerPubkey);
    const dbcKeys = parseDbcPoolKeys(dbcPoolKeys);

    const ixs: TransactionInstruction[] = [];

    // Keep confirmations snappy during congestion
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(priorityMicros) || 0 }));

    // 1) DBC: claim trading fees (creator/partner payout)
    ixs.push(await buildDbcClaimTradingFeeIx({ connection, poolKeys: dbcKeys, feeClaimer: owner }));

    // 2) (Optional) DAMM v2: remove ALL LP (only if migrated & keys provided)
    if (includeDammV2Exit) {
      if (!dammV2PoolKeys) {
        return res.status(400).json({ error: 'includeDammV2Exit=true but dammV2PoolKeys missing' });
      }
      const dammKeys = parseDammV2PoolKeys(dammV2PoolKeys);
      const dammIxs = await buildDammV2RemoveAllLpIxs({ connection, owner, poolKeys: dammKeys });
      ixs.push(...dammIxs);
    }

    const { blockhash } = await connection.getLatestBlockhash('finalized');

    const msg = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);
    const serialized = Buffer.from(vtx.serialize()).toString('base64');

    return res.status(200).json({ tx: serialized, blockhash });
  } catch (e: any) {
    console.error('[api/dbc-one-click-exit] error:', e);
    return res.status(500).json({ error: e?.message ?? 'Internal error' });
  }
}
