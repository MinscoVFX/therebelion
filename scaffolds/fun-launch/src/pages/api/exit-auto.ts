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
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import {
  getAssociatedTokenAddressSync,
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

/** Probe helpers we might have in studio/dist/lib/damm_v2/index.js */
function pickPoolResolver(mod: any) {
  // Try common names: resolve/get pool by LP mint
  return (
    mod?.getPoolByLpMint ||
    mod?.resolvePoolByLpMint ||
    mod?.poolFromLpMint ||
    (mod?.helpers && (mod.helpers.getPoolByLpMint || mod.helpers.resolvePoolByLpMint)) ||
    null
  );
}

function pickRemoveBuilder(mod: any) {
  return (
    mod?.buildRemoveLiquidityIx ||
    mod?.removeLiquidityIx ||
    (mod?.builders && (mod.builders.buildRemoveLiquidityIx || mod.builders.removeLiquidity)) ||
    null
  );
}

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

/** Read the owner's LP balance (base units) */
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

/** Scan all token accounts for LP mints; return the largest LP candidate & its pool keys. */
async function findBestDammLpAndPool(
  conn: Connection,
  owner: PublicKey
): Promise<{ lpMint: PublicKey; poolKeys: DammV2PoolKeys; lpAmount: bigint } | null> {
  const damm = await importDammRuntime();
  if (!damm) throw new Error('Studio DAMM v2 runtime not found (studio/dist/lib/damm_v2/index.js)');

  const resolvePool = pickPoolResolver(damm);
  if (!resolvePool) {
    throw new Error(
      'No pool resolver exported in studio/dist/lib/damm_v2 (expected getPoolByLpMint/resolvePoolByLpMint).'
    );
  }

  // Fetch SPL + SPL2022 accounts (wallet-owned)
  const [splRes, spl22Res] = await Promise.all([
    conn.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    conn.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }).catch(() => ({ value: [] as any[] })),
  ]);

  const tokenAccs = [...splRes.value, ...(spl22Res?.value ?? [])];

  // Map mints -> balances
  const candidates: Array<{ lpMint: PublicKey; amount: bigint }> = [];
  for (const it of tokenAccs) {
    const info = it.account.data;
    // Using parsed data is simpler; but in getTokenAccountsByOwner raw mode we don't parse.
    // Instead, fetch balance by ATA later; here we just collect mints from account.data via RPC "parsed" path.
  }

  // Simpler & robust: get all parsed token accounts (SPL only), then try 2022 via try/catch
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

  // Try to include 2022 (best effort)
  try {
    const parsed22 = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });
    for (const it of parsed22.value) {
      const data: any = it.account.data;
      const mintStr = data?.parsed?.info?.mint;
      const amountStr = data?.parsed?.info?.tokenAmount?.amount;
      if (!mintStr || !amountStr) continue;
      const amt = BigInt(amountStr);
      if (amt === 0n) continue;
      candidates.push({ lpMint: new PublicKey(mintStr), amount: amt });
    }
  } catch {
    // ignore if 2022 not supported by RPC
  }

  // For each candidate mint, ask Studio if it's a DAMM v2 LP (resolve pool by LP mint)
  const poolable: Array<{ lpMint: PublicKey; lpAmount: bigint; poolKeys: DammV2PoolKeys }> = [];
  for (const c of candidates) {
    try {
      const pool = await resolvePool({
        connection: conn,
        lpMint: c.lpMint,
      });
      if (!pool) continue;

      // Expect the resolved object to contain these fields; adapt if your runtime differs.
      const maybe: any = pool;
      const pk: DammV2PoolKeys = {
        programId: new PublicKey(maybe.programId),
        pool: new PublicKey(maybe.pool),
        lpMint: new PublicKey(maybe.lpMint ?? c.lpMint),
        tokenAMint: new PublicKey(maybe.tokenAMint),
        tokenBMint: new PublicKey(maybe.tokenBMint),
        tokenAVault: new PublicKey(maybe.tokenAVault),
        tokenBVault: new PublicKey(maybe.tokenBVault),
        authorityPda: new PublicKey(maybe.authorityPda ?? maybe.poolAuthority ?? maybe.authority),
      };

      // re-check balance on ATA (authoritative)
      const amt = await getUserLpAmount(conn, owner, pk.lpMint);
      if (amt > 0n) {
        poolable.push({ lpMint: pk.lpMint, lpAmount: amt, poolKeys: pk });
      }
    } catch {
      // Not a DAMM v2 LP (or resolver threw) — skip
    }
  }

  if (!poolable.length) return null;

  // Pick the largest LP position (reduces CU, "most meaningful" exit)
  poolable.sort((a, b) => (b.lpAmount > a.lpAmount ? 1 : b.lpAmount < a.lpAmount ? -1 : 0));
  return poolable[0];
}

function createAtaIxIfMissing(
  owner: PublicKey,
  mint: PublicKey,
  splToken: typeof import('@solana/spl-token')
): TransactionInstruction {
  const ata = getAssociatedTokenAddressSync(mint, owner, false);
  return splToken.createAssociatedTokenAccountIdempotentInstruction(
    owner, ata, owner, mint
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

    const { ownerPubkey, priorityMicros = 250_000 } = req.body as {
      ownerPubkey: string;
      priorityMicros?: number;
    };

    if (!ownerPubkey) return res.status(400).json({ error: 'Missing ownerPubkey' });
    const owner = new PublicKey(ownerPubkey);

    // 1) Find the "best" DAMM v2 LP (largest) for this wallet
    const best = await findBestDammLpAndPool(connection, owner);
    if (!best) {
      return res.status(404).json({ error: 'No DAMM v2 LP found for this wallet.' });
    }

    // 2) Import studio runtime & remove builder
    const damm = await importDammRuntime();
    if (!damm) throw new Error('Studio DAMM v2 runtime not found (studio/dist/lib/damm_v2/index.js)');

    const removeBuilder =
      damm.buildRemoveLiquidityIx ||
      damm.removeLiquidityIx ||
      (damm.builders && (damm.builders.buildRemoveLiquidityIx || damm.builders.removeLiquidity));

    if (!removeBuilder) {
      return res.status(500).json({ error: 'Remove-liquidity builder missing in studio/dist/lib/damm_v2.' });
    }

    // 3) Build instructions: priority fee, ensure ATAs for underlying, remove 100% LP
    const splToken = await import('@solana/spl-token');

    const ixs: TransactionInstruction[] = [];
    ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(priorityMicros) || 0 }));

    // Ensure receiver ATAs exist
    ixs.push(createAtaIxIfMissing(owner, best.poolKeys.tokenAMint, splToken));
    ixs.push(createAtaIxIfMissing(owner, best.poolKeys.tokenBMint, splToken));

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
      lpAmount: best.lpAmount, // remove ALL
    });

    ixs.push(...(Array.isArray(removeIxs) ? removeIxs : [removeIxs]));

    // 4) Return v0 tx for the wallet to sign
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
