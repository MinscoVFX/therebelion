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

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Robust Studio DAMM v2 runtime resolution
function resolveStudioDammV2(): string | null {
  try {
    return require.resolve('@meteora-invent/studio/dist/lib/damm_v2/index.js');
  } catch {
    try {
      return path.join(process.cwd(), '../../studio/dist/lib/damm_v2/index.js');
    } catch {
      return null;
    }
  }
}

async function importDammRuntime(): Promise<any | null> {
  const target = resolveStudioDammV2();
  if (!target) return null;
  // @ts-ignore
  const mod = await import(/* webpackIgnore: true */ target);
  return mod ?? null;
}

function pickPoolResolver(mod: any): ((args: any) => Promise<any>) | null {
  return (
    mod?.getPoolByLpMint ||
    mod?.resolvePoolByLpMint ||
    mod?.poolFromLpMint ||
    (mod?.helpers && (mod.helpers.getPoolByLpMint || mod.helpers.resolvePoolByLpMint)) ||
    null
  );
}
function pickRemoveBuilder(mod: any): ((args: any) => Promise<any>) | null {
  return (
    mod?.buildRemoveLiquidityIx ||
    mod?.removeLiquidityIx ||
    (mod?.builders && (mod.builders.buildRemoveLiquidityIx || mod.builders.removeLiquidity)) ||
    null
  );
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

async function findBestDammLpAndPool(
  conn: Connection,
  owner: PublicKey
): Promise<{ lpMint: PublicKey; lpAmount: bigint; poolKeys: any } | null> {
  const damm = await importDammRuntime();
  if (!damm) throw new Error('Studio DAMM v2 runtime not found (studio dist missing).');
  const resolvePool = pickPoolResolver(damm);
  if (!resolvePool) throw new Error('Missing pool resolver export in Studio DAMM v2 runtime.');

  const candidates: Array<{ lpMint: PublicKey; amount: bigint }> = [];
  const parsed = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });
  for (const it of parsed.value) {
    const data: any = it.account.data;
    const mintStr = data?.parsed?.info?.mint;
    const amountStr = data?.parsed?.info?.tokenAmount?.amount;
    if (!mintStr || !amountStr) continue;
    const amt = BigInt(amountStr);
    if (amt === 0n) continue;
    candidates.push({ lpMint: new PublicKey(mintStr), amount: amt });
  }
  if (!candidates.length) return null;

  const poolable: Array<{ lpMint: PublicKey; lpAmount: bigint; poolKeys: any }> = [];
  for (const c of candidates) {
    try {
      const pool: any = await resolvePool({ connection: conn, lpMint: c.lpMint });
      if (!pool) continue;
      const pk = {
        programId: new PublicKey(pool.programId),
        pool: new PublicKey(pool.pool),
        lpMint: new PublicKey(pool.lpMint ?? c.lpMint),
        tokenAMint: new PublicKey(pool.tokenAMint),
        tokenBMint: new PublicKey(pool.tokenBMint),
        tokenAVault: new PublicKey(pool.tokenAVault),
        tokenBVault: new PublicKey(pool.tokenBVault),
        authorityPda: new PublicKey(pool.authorityPda ?? pool.poolAuthority ?? pool.authority),
      };
      const amt = await getUserLpAmount(conn, owner, pk.lpMint);
      if (amt > 0n) poolable.push({ lpMint: pk.lpMint, lpAmount: amt, poolKeys: pk });
    } catch {
      // Not a DAMM v2 LP — skip
    }
  }
  if (!poolable.length) return null;

  poolable.sort((a, b) => (a.lpAmount < b.lpAmount ? 1 : a.lpAmount > b.lpAmount ? -1 : 0));
  return poolable[0] ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

    const { ownerPubkey, priorityMicros = 250_000 } = (req.body ?? {}) as {
      ownerPubkey?: string;
      priorityMicros?: number;
    };
    if (!ownerPubkey) return res.status(400).json({ error: 'Missing ownerPubkey' });

    const owner = new PublicKey(ownerPubkey);

    const best = await findBestDammLpAndPool(connection, owner);
    if (!best) return res.status(404).json({ error: 'No DAMM v2 LP found for this wallet.' });

    const damm = await importDammRuntime();
    if (!damm) throw new Error('Studio DAMM v2 runtime not found (studio dist missing).');
    const removeBuilder = pickRemoveBuilder(damm);
    if (!removeBuilder) return res.status(500).json({ error: 'Remove-liquidity builder missing in Studio runtime.' });

    const ixs: TransactionInstruction[] = [];
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(priorityMicros) || 0 }));

    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        getAssociatedTokenAddressSync(best.poolKeys.tokenAMint, owner, false),
        owner,
        best.poolKeys.tokenAMint
      )
    );
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        getAssociatedTokenAddressSync(best.poolKeys.tokenBMint, owner, false),
        owner,
        best.poolKeys.tokenBMint
      )
    );

    const userLpAta = getAssociatedTokenAddressSync(best.poolKeys.lpMint, owner, false);

    const removeIxs: TransactionInstruction | TransactionInstruction[] = await removeBuilder({
      programId: best.poolKeys.programId,
      pool: best.poolKeys.pool,
      authorityPda: best.poolKeys.authorityPda,
      lpMint: best.poolKeys.lpMint,
      tokenAVault: best.poolKeys.tokenAVault,
      tokenBVault: best.poolKeys.tokenBVault,
      user: owner,
      userLpAccount: userLpAta,
      userAToken: getAssociatedTokenAddressSync(best.poolKeys.tokenAMint, owner, false),
      userBToken: getAssociatedTokenAddressSync(best.poolKeys.tokenBMint, owner, false),
      lpAmount: best.lpAmount,
    });

    ixs.push(...(Array.isArray(removeIxs) ? removeIxs : [removeIxs]));

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const msg = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);
    const serialized = Buffer.from(vtx.serialize()).toString('base64');

    return res.status(200).json({
      tx: serialized,
      blockhash,
      pickedLpMint: best.lpMint.toBase58(),
      pool: best.poolKeys.pool.toBase58(),
    });
  } catch (e: any) {
    console.error('[api/exit-auto] error:', e);
    return res.status(500).json({ error: e?.message ?? 'Internal error' });
  }
}
