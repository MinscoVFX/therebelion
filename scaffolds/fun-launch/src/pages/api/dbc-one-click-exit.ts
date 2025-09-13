import type { NextApiRequest, NextApiResponse } from 'next';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

type DbcPoolKeys = { pool: PublicKey; feeVault: PublicKey };
type DammV2PoolKeys = {
  programId: PublicKey;
  pool: PublicKey;
  lpMint: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  authorityPda: PublicKey;
};

function resolveStudioDist(subpath: string): string | null {
  try {
    const pkg = require.resolve('@meteora-invent/studio/package.json');
    const base = path.dirname(pkg);
    const candidate = path.join(base, 'dist', subpath);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
async function importStudioModule(subpath: string): Promise<any | null> {
  const target = resolveStudioDist(subpath);
  if (!target) return null;
  // @ts-ignore
  const mod = await import(/* webpackIgnore: true */ target);
  return mod ?? null;
}

async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey;
}): Promise<TransactionInstruction> {
  const mod = await importStudioModule('lib/dbc/index.js');
  if (!mod) throw new Error('DBC runtime not found (studio dist missing).');

  const builder =
    mod.buildClaimTradingFeeIx ||
    mod.claimTradingFeeIx ||
    (mod.builders && (mod.builders.buildClaimTradingFeeIx || mod.builders.claimTradingFee)) ||
    null;

  if (!builder) throw new Error('DBC claim fee builder not found in Studio runtime.');

  try {
    return await builder({
      connection: args.connection,
      poolKeys: { pool: args.poolKeys.pool, feeVault: args.poolKeys.feeVault },
      feeClaimer: args.feeClaimer,
    });
  } catch {
    return await builder(args.connection, args.poolKeys, args.feeClaimer);
  }
}

async function pickDammRemoveBuilder(): Promise<
  (params: any) => Promise<TransactionInstruction | TransactionInstruction[]>
> {
  const mod = await importStudioModule('lib/damm_v2/index.js');
  if (!mod) throw new Error('DAMM v2 runtime not found (studio dist missing).');

  const builder =
    mod.buildRemoveLiquidityIx ||
    mod.removeLiquidityIx ||
    (mod.builders && (mod.builders.buildRemoveLiquidityIx || mod.builders.removeLiquidity)) ||
    null;

  if (!builder) throw new Error('Remove-liquidity builder missing in DAMM v2 runtime.');
  return builder;
}

async function getUserLpAmount(conn: Connection, owner: PublicKey, lpMint: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(lpMint, owner, false);
  try {
    const bal = await conn.getTokenAccountBalance(ata);
    if (!bal?.value) return 0n;
    return BigInt(bal.value.amount ?? '0');
  } catch {
    return 0n;
  }
}

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

    const {
      ownerPubkey,
      dbcPoolKeys,
      includeDammV2Exit = false,
      dammV2PoolKeys,
      priorityMicros = 250_000,
    } = (req.body ?? {}) as {
      ownerPubkey?: string;
      dbcPoolKeys?: { pool: string; feeVault: string };
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
    const parsedDbc = parseDbcPoolKeys(dbcPoolKeys);

    const ixs: TransactionInstruction[] = [];
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(priorityMicros) || 0 }));

    // 1) DBC fees
    ixs.push(
      await buildDbcClaimTradingFeeIx({
        connection,
        poolKeys: parsedDbc,
        feeClaimer: owner,
      })
    );

    // 2) Optional DAMM v2 exit (for a specific pool, if provided)
    if (includeDammV2Exit) {
      if (!dammV2PoolKeys) {
        return res.status(400).json({ error: 'includeDammV2Exit=true but dammV2PoolKeys missing' });
      }
      const parsedDamm = parseDammV2PoolKeys(dammV2PoolKeys);
      const removeBuilder = await pickDammRemoveBuilder();

      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          getAssociatedTokenAddressSync(parsedDamm.tokenAMint, owner, false),
          owner,
          parsedDamm.tokenAMint
        )
      );
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          getAssociatedTokenAddressSync(parsedDamm.tokenBMint, owner, false),
          owner,
          parsedDamm.tokenBMint
        )
      );

      const userLpAta = getAssociatedTokenAddressSync(parsedDamm.lpMint, owner, false);
      const lpAmount = await getUserLpAmount(connection, owner, parsedDamm.lpMint);
      if (lpAmount === 0n) {
        return res.status(400).json({ error: 'No LP tokens found for the provided DAMM v2 pool.' });
      }

      const dammIxs = await removeBuilder({
        programId: parsedDamm.programId,
        pool: parsedDamm.pool,
        authorityPda: parsedDamm.authorityPda,
        lpMint: parsedDamm.lpMint,
        tokenAVault: parsedDamm.tokenAVault,
        tokenBVault: parsedDamm.tokenBVault,
        user: owner,
        userLpAccount: userLpAta,
        userAToken: getAssociatedTokenAddressSync(parsedDamm.tokenAMint, owner, false),
        userBToken: getAssociatedTokenAddressSync(parsedDamm.tokenBMint, owner, false),
        lpAmount,
      });

      ixs.push(...(Array.isArray(dammIxs) ? dammIxs : [dammIxs]));
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
