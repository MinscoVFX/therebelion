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

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

/** Runtime import of Studio DAMM v2 compiled JS (prevents Next bundling TS). */
async function importDammRuntime(): Promise<any | null> {
  const path = ['../../../../studio', 'dist', 'lib', 'damm_v2', 'index.js'].join('/');
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const mod = await import(/* webpackIgnore: true */ path);
    return mod ?? null;
  } catch {
    return null;
  }
}

/** Pick a resolver function by LP mint from the compiled Studio module (names vary slightly). */
function pickPoolResolver(mod: any): ((args: any) => Promise<any>) | null {
  return (
    mod?.getPoolByLpMint ||
    mod?.resolvePoolByLpMint ||
    mod?.poolFromLpMint ||
    (mod?.helpers && (mod.helpers.getPoolByLpMint || mod.helpers.resolvePoolByLpMint)) ||
    null
  );
}

/** Pick a remove-liquidity builder from the compiled Studio module (names vary slightly). */
function pickRemoveBuilder(mod: any): ((args: any) => Promise<any>) | null {
  return (
    mod?.buildRemoveLiquidityIx ||
    mod?.removeLiquidityIx ||
    (mod?.builders && (mod.builders.buildRemoveLiquidityIx || mod.builders.removeLiquidity)) ||
    null
  );
}

/** Read base-units LP balance from owner’s ATA (0n if missing). */
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
  if (!damm) throw new Error('Studio DAMM v2 runtime not found (studio/dist/lib/damm_v2/index.js)');
  const resolvePool = pickPoolResolver(damm);
  if (!resolvePool) {
    throw new Error(
      'No pool resolver exported in studio/dist/lib/damm_v2 (expected getPoolByLpMint/resolvePoolByLpMint).'
    );
  }

  // Collect parsed SPL token accounts
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
  if (candidates.length === 0) return null;

  // Probe each candidate with the Studio resolver, then re-fetch ATA balance
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
      // not a DAMM v2 LP, or resolver threw – skip
    }
  }
  if (poolable.length === 0) return null;

  poolable.sort((a, b) => (a.lpAmount < b.lpAmount ? 1 : a.lpAmount > b.lpAmount ? -1 : 0));
  const best = poolable[0];
  return best ?? null;
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

    // 1) Pick the best (largest) DAMM v2 LP
    const best = await findBestDammLpAndPool(connection, owner);
    if (!best) return res.status(404).json({ error: 'No DAMM v2 LP found for this wallet.' });

    // 2) Load remove builder
    const damm = await importDammRuntime();
    if (!damm) throw new Error('Studio DAMM v2 runtime not found (studio/dist/lib/damm_v2/index.js)');
    const removeBuilder = pickRemoveBuilder(damm);
    if (!removeBuilder) {
      return res.status(500).json({ error: 'Remove-liquidity builder missing in studio/dist/lib/damm_v2.' });
    }

    // 3) Build the tx (priority fee + ensure ATAs + remove 100% LP)
    const ixs: TransactionInstruction[] = [];
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(priorityMicros) || 0 }));

    ixs.push(createAssociatedTokenAccountIdempotentInstruction(
      owner,
      getAssociatedTokenAddressSync(best.poolKeys.tokenAMint, owner, false),
      owner,
      best.poolKeys.tokenAMint
    ));
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(
      owner,
      getAssociatedTokenAddressSync(best.poolKeys.tokenBMint, owner, false),
      owner,
      best.poolKeys.tokenBMint
    ));

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
      lpAmount: best.lpAmount, // remove ALL LP
    });

    ixs.push(...(Array.isArray(removeIxs) ? removeIxs : [removeIxs]));

    // 4) Return a v0 transaction for wallet to sign
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
