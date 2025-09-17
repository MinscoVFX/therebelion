import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

// Reuse the Studio runtime loader if available in this workspace
import { getDammV2Runtime } from '../../../scaffolds/fun-launch/src/server/studioRuntime';

type StringKeys = {
  programId: string;
  pool: string;
  lpMint: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenAVault: string;
  tokenBVault: string;
  authorityPda: string;
};

type Body = {
  owner?: string; // wallet public key (base58)
  largestOnly?: boolean; // if true, pick only the position with the largest LP amount
};

function resolveRpcFromEnv(): string {
  return (
    process.env.RPC_URL ||
    process.env.RPC_ENDPOINT ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    'https://api.mainnet-beta.solana.com'
  );
}

type PoolResolver = (args: {
  connection: Connection;
  lpMint: PublicKey;
}) => Promise<ResolvedLike | null>;

type ResolvedLike = {
  programId: PublicKey | string;
  pool: PublicKey | string;
  lpMint: PublicKey | string;
  tokenAMint: PublicKey | string;
  tokenBMint: PublicKey | string;
  tokenAVault: PublicKey | string;
  tokenBVault: PublicKey | string;
  authorityPda?: PublicKey | string;
  poolAuthority?: PublicKey | string;
  authority?: PublicKey | string;
};

function isFunction(v: unknown): v is (...args: unknown[]) => unknown {
  return typeof v === 'function';
}

function pickPoolResolver(mod: unknown): PoolResolver | null {
  const m = mod as Record<string, unknown> | null | undefined;
  if (!m) return null;
  const direct = m.getPoolByLpMint ?? m.resolvePoolByLpMint ?? m.poolFromLpMint;
  if (isFunction(direct)) {
    const fn = direct as (args: {
      connection: Connection;
      lpMint: PublicKey;
    }) => Promise<ResolvedLike>;
    return async (args) => (await fn(args)) as ResolvedLike;
  }
  const helpers = m.helpers as Record<string, unknown> | undefined;
  if (helpers) {
    const h = helpers.getPoolByLpMint ?? helpers.resolvePoolByLpMint;
    if (isFunction(h)) {
      const fn = h as (args: {
        connection: Connection;
        lpMint: PublicKey;
      }) => Promise<ResolvedLike>;
      return async (args) => (await fn(args)) as ResolvedLike;
    }
  }
  return null;
}

async function getUserLpAmount(
  conn: Connection,
  owner: PublicKey,
  lpMint: PublicKey
): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(lpMint, owner, false);
    const info = await conn.getTokenAccountBalance(ata);
    const raw = info?.value?.amount ?? '0';
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body: Body = (() => {
      try {
        return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as Body);
      } catch {
        return {} as Body;
      }
    })();
    if (!body.owner) return res.status(400).json({ error: 'owner required' });

    const connection = new Connection(resolveRpcFromEnv(), 'confirmed');
    const owner = new PublicKey(body.owner);

    // 1) Get all DAMM v2 positions for this wallet via SDK helper
    const cp = new CpAmm(connection);
    type OwnerArg = { owner: PublicKey };
    type PositionLike = {
      account?: { pool?: PublicKey; lpMint?: PublicKey; lp_token_mint?: PublicKey };
    };
    type PositionHelper = (args: OwnerArg) => Promise<PositionLike[] | ReadonlyArray<PositionLike>>;
    const helperA = (cp as unknown as { getAllPositionNftAccountByOwner?: PositionHelper })
      .getAllPositionNftAccountByOwner;
    const helperB = (cp as unknown as { getAllUserPositionNftAccount?: PositionHelper })
      .getAllUserPositionNftAccount;
    const helper: PositionHelper | null = helperA ?? helperB ?? null;
    if (!helper) return res.status(500).json({ error: 'sdk position helper missing' });

    let rawPositions: PositionLike[] = [];
    try {
      const fetched = await helper({ owner });
      rawPositions = Array.isArray(fetched) ? [...fetched] : [];
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return res.status(500).json({ error: 'position scan failed', detail });
    }

    // Normalize to unique pools and (optionally) associated lp mints from position accounts
    const byPool = new Map<string, { pool: PublicKey; lpMint?: PublicKey }>();
    for (const p of rawPositions) {
      const acct = p?.account || {};
      const poolPk: PublicKey | undefined = acct.pool;
      const lpMintPk: PublicKey | undefined = acct.lpMint || acct.lp_token_mint;
      if (!poolPk) continue;
      const key = poolPk.toBase58();
      if (!byPool.has(key)) byPool.set(key, { pool: poolPk, lpMint: lpMintPk });
    }
    if (!byPool.size) return res.status(200).json({ keys: [] as StringKeys[] });

    // 2) Try to use Studio runtime to resolve full pool keys by lpMint (more robust for authority)
    let resolver: PoolResolver | null = null;
    try {
      const damm = await getDammV2Runtime();
      resolver = damm ? pickPoolResolver(damm) : null;
    } catch {
      resolver = null;
    }

    // 3) For each pool, resolve keys either via resolver or via cp-amm fetchPoolState fallback
    const candidates: Array<{ keys: StringKeys; lpAmount: bigint }> = [];
    for (const entry of byPool.values()) {
      try {
        let resolved: ResolvedLike | null = null;
        if (resolver && entry.lpMint) {
          try {
            resolved = await resolver({ connection, lpMint: entry.lpMint });
          } catch {
            resolved = null;
          }
        }

        if (!resolved) {
          // Fallback: fetch pool state via SDK and derive keys
          const state: unknown = await (
            cp as CpAmm & { fetchPoolState: (pool: PublicKey) => Promise<unknown> }
          ).fetchPoolState(entry.pool);
          // Program ID = owner of pool account
          const info = await connection.getAccountInfo(entry.pool);
          const programId = info?.owner;
          // Map common field names defensively
          const obj = (state as Record<string, unknown>) || {};
          const pickPk = (o: Record<string, unknown>, names: string[]): PublicKey | undefined => {
            for (const n of names) {
              const v = o[n];
              if (v instanceof PublicKey) return v;
            }
            return undefined;
          };
          const tokenAMint: PublicKey | undefined = pickPk(obj, [
            'tokenAMint',
            'tokenA',
            'mintA',
            'token_a_mint',
          ]);
          const tokenBMint: PublicKey | undefined = pickPk(obj, [
            'tokenBMint',
            'tokenB',
            'mintB',
            'token_b_mint',
          ]);
          const tokenAVault: PublicKey | undefined = pickPk(obj, [
            'tokenAVault',
            'tokenAReserve',
            'vaultA',
            'token_a_vault',
          ]);
          const tokenBVault: PublicKey | undefined = pickPk(obj, [
            'tokenBVault',
            'tokenBReserve',
            'vaultB',
            'token_b_vault',
          ]);
          const lpMint: PublicKey | undefined = ((): PublicKey | undefined => {
            const v = (obj.lpMint ?? obj.lp_token_mint) as unknown;
            return v instanceof PublicKey ? v : entry.lpMint;
          })();
          const authorityLike: PublicKey | undefined = pickPk(obj, [
            'authorityPda',
            'poolAuthority',
            'authority',
          ]);
          if (!programId || !tokenAMint || !tokenBMint || !tokenAVault || !tokenBVault || !lpMint) {
            // Skip incomplete
            continue;
          }
          resolved = {
            programId,
            pool: entry.pool,
            lpMint,
            tokenAMint,
            tokenBMint,
            tokenAVault,
            tokenBVault,
            authorityPda: authorityLike,
          };
        }

        const keys: StringKeys = {
          programId:
            resolved.programId instanceof PublicKey
              ? resolved.programId.toBase58()
              : String(resolved.programId),
          pool:
            resolved.pool instanceof PublicKey ? resolved.pool.toBase58() : entry.pool.toBase58(),
          lpMint:
            resolved.lpMint instanceof PublicKey
              ? resolved.lpMint.toBase58()
              : entry.lpMint?.toBase58?.() || '',
          tokenAMint:
            resolved.tokenAMint instanceof PublicKey ? resolved.tokenAMint.toBase58() : '',
          tokenBMint:
            resolved.tokenBMint instanceof PublicKey ? resolved.tokenBMint.toBase58() : '',
          tokenAVault:
            resolved.tokenAVault instanceof PublicKey ? resolved.tokenAVault.toBase58() : '',
          tokenBVault:
            resolved.tokenBVault instanceof PublicKey ? resolved.tokenBVault.toBase58() : '',
          authorityPda:
            resolved.authorityPda instanceof PublicKey
              ? resolved.authorityPda.toBase58()
              : resolved.poolAuthority instanceof PublicKey
                ? resolved.poolAuthority.toBase58()
                : resolved.authority instanceof PublicKey
                  ? resolved.authority.toBase58()
                  : '',
        };

        if (
          !keys.lpMint ||
          !keys.tokenAMint ||
          !keys.tokenBMint ||
          !keys.tokenAVault ||
          !keys.tokenBVault
        ) {
          // still incomplete
          continue;
        }

        const amt = await getUserLpAmount(connection, owner, new PublicKey(keys.lpMint));
        candidates.push({ keys, lpAmount: amt });
      } catch {
        // skip pool on error
      }
    }

    if (!candidates.length) return res.status(200).json({ keys: [] as StringKeys[] });

    if (body.largestOnly) {
      candidates.sort((a, b) => (a.lpAmount < b.lpAmount ? 1 : a.lpAmount > b.lpAmount ? -1 : 0));
      return res.status(200).json({ keys: [candidates[0].keys] });
    }

    return res.status(200).json({ keys: candidates.map((c) => c.keys) });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: err });
  }
}
