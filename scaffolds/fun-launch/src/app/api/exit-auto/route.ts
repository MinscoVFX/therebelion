import { NextResponse } from 'next/server';
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
import { resolveRpc } from '../../../lib/rpc';
import path from 'path';

/** Resolve compiled Studio DAMM v2 JS entry robustly (monorepo + Vercel). */
function resolveStudioDammV2(): string | null {
  try {
    // Prefer resolving via the workspace package name
    // (works when @meteora-invent/studio is a dependency of fun-launch)
    return require.resolve('@meteora-invent/studio');
  } catch {
    // Fallback to a relative path from fun-launch after Turbo build
    try {
      return path.join(process.cwd(), '../../studio/dist/lib/damm_v2/index.js');
    } catch {
      return null;
    }
  }
}

/** Runtime import of compiled JS (prevents Next from bundling studio/src TS). */
async function importDammRuntime(): Promise<any | null> {
  const target = resolveStudioDammV2();
  if (!target) return null;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - dynamic path, tell webpack to ignore bundling
  const mod = await import(/* webpackIgnore: true */ target);
  return mod ?? null;
}

/** Pick helpers that may have slightly different export names across versions. */
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

/** Read base-units LP balance from owner's ATA (0n if missing). */
async function getUserLpAmount(
  conn: Connection,
  owner: PublicKey,
  lpMint: PublicKey
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(lpMint, owner, false);
  try {
    const bal = await conn.getTokenAccountBalance(ata);
    if (!bal?.value) return 0n;
    return BigInt(bal.value.amount ?? '0');
  } catch {
    return 0n;
  }
}

/** Find largest DAMM v2 LP owned by wallet using Studio resolver + parsed SPL accounts. */
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

// Auto-exit implementation: build a real DAMM v2 liquidity removal transaction
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { ownerPubkey, priorityMicros = 250_000 } = body;
    if (!ownerPubkey) return NextResponse.json({ error: 'Missing ownerPubkey' }, { status: 400 });

    const connection = new Connection(resolveRpc(), 'confirmed');
    const owner = new PublicKey(ownerPubkey);

    // 1) Find largest DAMM v2 LP this wallet owns
    const best = await findBestDammLpAndPool(connection, owner);
    if (!best)
      return NextResponse.json({ error: 'No DAMM v2 LP found for this wallet.' }, { status: 404 });

    // 2) Load Studio remove-liquidity builder
    const damm = await importDammRuntime();
    if (!damm) throw new Error('Studio DAMM v2 runtime not found (studio dist missing).');
    const removeBuilder = pickRemoveBuilder(damm);
    if (!removeBuilder) {
      return NextResponse.json(
        { error: 'Remove-liquidity builder missing in Studio runtime.' },
        { status: 500 }
      );
    }

    // 3) Build tx: priority fee, ensure ATAs, remove 100% LP
    const ixs: TransactionInstruction[] = [];
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(priorityMicros) || 0 })
    );

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
      lpAmount: best.lpAmount, // 100%
    });

    ixs.push(...(Array.isArray(removeIxs) ? removeIxs : [removeIxs]));

    // 4) Return a v0 transaction for wallet to sign
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    const msg = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);
    const serialized = Buffer.from(vtx.serialize()).toString('base64');

    return NextResponse.json({
      tx: serialized,
      lastValidBlockHeight,
      blockhash,
      pickedLpMint: best.lpMint.toBase58(),
      pool: best.poolKeys.pool.toBase58(),
      priorityMicrosUsed: priorityMicros,
    });
  } catch (e: any) {
    console.error('[api/exit-auto] error:', e);
    return NextResponse.json({ error: e?.message ?? 'Internal error' }, { status: 500 });
  }
}
