/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
  type Commitment,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as nacl from 'tweetnacl';
import { createHash } from 'crypto';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
// Optional but very helpful for IDL-based decoding:
import type { Idl } from '@coral-xyz/anchor';
import { BorshCoder } from '@coral-xyz/anchor';

/** ========== Env helper ========== */
const env = (k: string): string => (process.env[k] || '').trim();

const COMMITMENT: Commitment = (env('COMMITMENT_LEVEL') as Commitment) || 'confirmed';

/** ========== Types ========== */
type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
  usedConfig?: string;
  usedProgram?: string;
};

type MinimalWallet = {
  publicKey: PublicKey;
  payer?: Keypair;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

/** ========== Inputs ========== */
function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = env('BASE_MINTS');
  if (!raw) throw new Error('BASE_MINTS is empty.');
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('No valid base mints found in BASE_MINTS.');
  return parts.map((s) => new PublicKey(s));
}

function parseConfigKeys(): string[] {
  const raw = env('DBC_CONFIG_KEYS');
  if (!raw) return ['(default)'];
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ['(default)'];
}

function parseProgramIds(): (PublicKey | null)[] {
  const raw = env('DBC_PROGRAM_IDS');
  if (!raw) return [null]; // fall back to client default
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [null];
  const out: (PublicKey | null)[] = [];
  for (const p of parts) {
    try {
      out.push(new PublicKey(p));
    } catch {
      // skip invalid one
    }
  }
  return out.length ? out : [null];
}

function parsePriorityFees() {
  const limitStr = env('COMPUTE_UNIT_LIMIT');
  const prioStr = env('PRIORITY_MICROLAMPORTS');
  const unitLimit = limitStr ? Number(limitStr) : 0;
  const prio = prioStr ? Number(prioStr) : 0;
  return {
    unitLimit: Number.isFinite(unitLimit) && unitLimit > 0 ? unitLimit : 0,
    prio: Number.isFinite(prio) && prio > 0 ? prio : 0,
  };
}

/** ========== Keypair ========== */
function jsonArrayToBytes(raw: string): Uint8Array {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid keypair.json format');
  const out: number[] = [];
  for (const v of parsed) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error('keypair.json must be an array of bytes (0..255)');
    out.push(n);
  }
  return Uint8Array.from(out);
}

function readKeypairJsonFile(p: string): Uint8Array {
  const raw = fs.readFileSync(path.resolve(p), 'utf8');
  const bytes = jsonArrayToBytes(raw);
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
  throw new Error(`Unsupported key length ${bytes.length} (need 32 or 64).`);
}

function getSigner(): Keypair {
  const keypairPath = env('KEYPAIR_PATH');
  if (!keypairPath) throw new Error('KEYPAIR_PATH required');
  return Keypair.fromSecretKey(readKeypairJsonFile(keypairPath));
}

/** ========== Helpers ========== */
function safeToBase58Field(obj: any, primary: string, fallback: string): string {
  const field = obj?.[primary] || obj?.[fallback];
  if (field && typeof field.toBase58 === 'function') return field.toBase58();
  if (typeof field === 'string') return field;
  return '';
}

function safePoolStatus(pool: any) {
  const status = pool?.state?.status || pool?.status || '';
  const completed =
    status === 'completed' ||
    status === 'finished' ||
    pool?.state?.isFinished === true ||
    pool?.isFinished === true ||
    status === 'curve_completed' ||
    status === 'curveComplete';
  return { status, completed };
}

function safeQuoteVault(pool: any): PublicKey | null {
  // try common field names
  const cand = pool?.vaultQuote || pool?.quoteVault || pool?.state?.vaultQuote || pool?.state?.quoteVault;
  try {
    return cand ? new PublicKey(cand) : null;
  } catch {
    return null;
  }
}

function isPubkeyLike(x: any): string | null {
  if (!x) return null;
  if (typeof x === 'string') return x;
  if (x instanceof PublicKey) return x.toBase58();
  if (typeof x.toBase58 === 'function') return x.toBase58();
  return null;
}

/** Anchor account discriminator bytes for a given account name (e.g. "Pool") */
function anchorDiscriminator(name: string): Buffer {
  const preimage = `account:${name}`;
  const hash = createHash('sha256').update(preimage).digest();
  return hash.subarray(0, 8);
}

/** Try to pull an IDL out of whatever this SDK exposes. */
function extractIdlFromClient(client: any): Idl | null {
  // common SDK shapes
  const idl: Idl | undefined =
    client?.program?.idl ||
    client?.program?._idl ||
    client?.idl ||
    client?._idl ||
    client?.provider?.program?.idl;
  return idl ? (idl as Idl) : null;
}

/** Attempt to decode a pool account and detect baseMint/config/quoteVault/status using the IDL. */
function decodePoolWithIdl(idl: Idl, data: Buffer): {
  ok: boolean;
  baseMint?: string;
  poolConfig?: string;
  quoteVault?: string;
  status?: string;
  isFinished?: boolean;
} {
  try {
    const coder = new BorshCoder(idl);
    // Try the most likely account names first, but fall back to any IDL account
    const accountNames = [
      'pool',
      'Pool',
      'bondingCurve',
      'BondingCurve',
      'state',
      'State',
      'poolV2',
      'PoolV2',
      ...(idl.accounts?.map((a) => a.name) || []),
    ];
    for (const name of accountNames) {
      try {
        const decoded: any = coder.accounts.decode(name as any, data);
        if (!decoded) continue;

        // Heuristic: dig out baseMint / config / quote vault / status-ish fields
        const baseMint =
          isPubkeyLike(decoded?.baseMint) ||
          isPubkeyLike(decoded?.state?.baseMint) ||
          isPubkeyLike(decoded?.base_mint);
        const poolConfig =
          isPubkeyLike(decoded?.config) ||
          isPubkeyLike(decoded?.state?.config) ||
          isPubkeyLike(decoded?.poolConfig) ||
          isPubkeyLike(decoded?.cfg);
        const quoteVault =
          isPubkeyLike(decoded?.vaultQuote) ||
          isPubkeyLike(decoded?.quoteVault) ||
          isPubkeyLike(decoded?.state?.vaultQuote) ||
          isPubkeyLike(decoded?.state?.quoteVault);

        const status = decoded?.status || decoded?.state?.status;
        const isFinished =
          decoded?.isFinished === true ||
          decoded?.state?.isFinished === true ||
          status === 'completed' ||
          status === 'finished' ||
          status === 'curve_completed';

        return {
          ok: true,
          baseMint: baseMint || undefined,
          poolConfig: poolConfig || undefined,
          quoteVault: quoteVault || undefined,
          status: typeof status === 'string' ? status : undefined,
          isFinished,
        };
      } catch {
        // try next account name
      }
    }
  } catch {
    // ignore
  }
  return { ok: false };
}

/**
 * Scan a program for pool accounts using the IDL (fast + robust),
 * then filter by baseMint and return a tiny “pool-lite” object for the claim step.
 */
async function findPoolByBaseMintOnChain(
  connection: Connection,
  programId: PublicKey,
  idl: Idl | null,
  targetBaseMint: PublicKey
): Promise<{ poolPk: PublicKey; poolConfig?: string; quoteVault?: PublicKey; rawStatus?: string; isFinished?: boolean } | null> {
  if (!idl) {
    return null; // we only do the discriminator scan when we have an IDL to decode account layouts
  }

  // Try likely account names for discriminator
  const accountNames = [
    'pool',
    'Pool',
    'bondingCurve',
    'BondingCurve',
    'state',
    'State',
    'poolV2',
    'PoolV2',
    ...(idl.accounts?.map((a) => a.name) || []),
  ];

  // Use a small data slice just to fetch whole data for decoding (no slice) – we need the full buffer to decode.
  // But we can filter by discriminator to narrow the set.
  for (const name of accountNames) {
    try {
      const disc = anchorDiscriminator(name);
      const accounts = await connection.getProgramAccounts(programId, {
        commitment: COMMITMENT,
        filters: [{ memcmp: { offset: 0, bytes: disc.toString('base64') } }],
      });

      for (const acc of accounts) {
        const decoded = decodePoolWithIdl(idl, acc.account.data);
        if (!decoded.ok) continue;

        const bm = decoded.baseMint ? new PublicKey(decoded.baseMint) : null;
        if (bm && bm.equals(targetBaseMint)) {
          return {
            poolPk: acc.pubkey,
            poolConfig: decoded.poolConfig,
            quoteVault: decoded.quoteVault ? new PublicKey(decoded.quoteVault) : undefined,
            rawStatus: decoded.rawStatus || decoded.status,
            isFinished: decoded.isFinished,
          };
        }
      }
    } catch {
      // try next account name
    }
  }

  return null;
}

/** Build candidate clients for every (configKey × programId) combo. */
function buildClientCombos(
  connection: Connection,
  wallet: MinimalWallet,
  configKeys: string[],
  programIds: (PublicKey | null)[]
): Array<{ label: string; client: any; programId: PublicKey | null; configKey: string }> {
  const combos: Array<{ label: string; client: any; programId: PublicKey | null; configKey: string }> = [];
  for (const configKey of configKeys) {
    for (const programId of programIds) {
      let client: any;
      try {
        if (configKey === '(default)') {
          client = new (DynamicBondingCurveClient as any)(connection, wallet);
        } else {
          client = new (DynamicBondingCurveClient as any)(connection, wallet, configKey);
        }
        if (programId) {
          try {
            (client as any).programId = programId;
          } catch {
            /* ignore */
          }
        }
      } catch {
        client = new (DynamicBondingCurveClient as any)(connection, wallet);
        if (programId) {
          try {
            (client as any).programId = programId;
          } catch {
            /* ignore */
          }
        }
      }
      const label = `${configKey}${programId ? ` @ ${programId.toBase58()}` : ''}`;
      combos.push({ label, client, programId, configKey });
    }
  }
  return combos;
}

/** Try all known SDK methods (across versions) to fetch a pool by baseMint. */
async function fetchPoolByBaseMint(client: any, baseMint: PublicKey): Promise<any | null> {
  for (const fn of ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool']) {
    const f = client?.[fn];
    if (typeof f === 'function') {
      try {
        const p = await f.call(client, baseMint);
        if (p) return p;
      } catch {
        // try next
      }
    }
  }
  // fallback: list & search
  for (const fn of ['listPools', 'getAllPools', 'fetchAllPools']) {
    const f = client?.[fn];
    if (typeof f === 'function') {
      try {
        const list = await f.call(client);
        if (Array.isArray(list)) {
          for (const p of list) {
            const bm = p?.baseMint || p?.state?.baseMint;
            try {
              if (bm && new PublicKey(bm).equals(baseMint)) return p;
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/** After we’ve found a pool pubkey (on-chain), try to hydrate it via any SDK method by address. */
async function hydratePoolByAddress(client: any, poolPk: PublicKey): Promise<any | null> {
  for (const fn of ['getPoolByAddress', 'fetchPoolByAddress', 'getPool', 'fetchPool', 'loadPool', 'pool']) {
    const f = client?.[fn];
    if (typeof f === 'function') {
      try {
        const p = await f.call(client, poolPk);
        if (p) return p;
      } catch {
        // try next name
      }
    }
  }
  return null;
}

/** Try a number of SDK claim builders, old and new. */
async function buildClaimIx(client: any, args: { pool: any; leftoverReceiver: PublicKey; payer: PublicKey }): Promise<any> {
  const variants: Array<() => Promise<any>> = [
    async () => client.buildClaimLeftoverInstruction?.({ pool: args.pool, leftoverReceiver: args.leftoverReceiver, payer: args.payer }),
    async () => client.claimLeftoverInstruction?.({ pool: args.pool, leftoverReceiver: args.leftoverReceiver, payer: args.payer }),
    async () =>
      client.claimLeftoverBase?.({
        poolPublicKey: new PublicKey(args.pool?.pubkey || args.pool?.address || args.pool),
        leftoverReceiver: args.leftoverReceiver,
        payer: args.payer,
      }),
    // Some SDKs accept raw pubkey under "pool"
    async () =>
      client.buildClaimLeftoverInstruction?.({
        pool: new PublicKey(args.pool?.pubkey || args.pool?.address || args.pool),
        leftoverReceiver: args.leftoverReceiver,
        payer: args.payer,
      }),
  ].filter(Boolean) as any[];

  let lastErr: any;
  for (const v of variants) {
    try {
      const ix = await v();
      if (ix) return ix;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No compatible leftover claim builder in this SDK version.');
}

/** ========== Main ========== */
async function main() {
  const rpcUrl = env('RPC_URL') || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, { commitment: COMMITMENT });

  const signer = getSigner();
  const wallet: MinimalWallet = {
    publicKey: signer.publicKey,
    payer: signer,
    signTransaction: async (tx) => (tx.partialSign(signer), tx),
    signAllTransactions: async (txs) => (txs.forEach((t) => t.partialSign(signer)), txs),
  };

  const baseMints = parseBaseMintsFromEnv();
  const lr = env('LEFTOVER_RECEIVER');
  const leftoverReceiver = lr ? new PublicKey(lr) : signer.publicKey;

  const configKeys = parseConfigKeys();
  const programIds = parseProgramIds();
  const combos = buildClientCombos(connection, wallet, configKeys, programIds);
  const { unitLimit, prio } = parsePriorityFees();

  console.log(`Wallet: ${signer.publicKey.toBase58()}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Commitment: ${COMMITMENT}`);
  console.log(`Receiver: ${leftoverReceiver.toBase58()}`);
  console.log(`Base mints: ${baseMints.length}`);
  console.log(`Config keys: ${configKeys.join(', ')}`);
  console.log(`Program IDs: ${programIds.map((p) => (p ? p.toBase58() : '(SDK default)')).join(', ')}`);
  if (unitLimit) console.log(`Compute units: ${unitLimit}`);
  if (prio) console.log(`Priority fee (microlamports): ${prio}`);

  const results: LeftoverReport[] = [];

  for (const baseMint of baseMints) {
    let claimedOrFound = false;

    for (const { label, client, programId, configKey } of combos) {
      console.log(`\n— Searching pool for ${baseMint.toBase58()} using ${label} ...`);

      const report: LeftoverReport = {
        baseMint: baseMint.toBase58(),
        status: 'skipped',
        usedConfig: configKey,
        usedProgram: programId ? programId.toBase58() : '',
      };

      try {
        // 1) Try the SDK’s own lookup first
        let pool: any = await fetchPoolByBaseMint(client, baseMint);

        // 2) If the SDK couldn’t find it AND we have a programId, scan on-chain via IDL decode
        if (!pool && programId) {
          const idl = extractIdlFromClient(client);
          const found = await findPoolByBaseMintOnChain(connection, programId, idl, baseMint);
          if (found) {
            report.pool = found.poolPk.toBase58();
            report.poolConfig = found.poolConfig || '';
            const hydrated = await hydratePoolByAddress(client, found.poolPk);
            pool = hydrated || { pubkey: found.poolPk, state: { baseMint: baseMint.toBase58() } };
          }
        }

        if (!pool) {
          console.log('  > No pool with this base mint on this config/program.');
          results.push({ ...report, status: 'error', error: 'Pool not found for this combo' });
          continue;
        }

        // record ids early
        report.pool = report.pool || safeToBase58Field(pool, 'pubkey', 'address');
        report.poolConfig = report.poolConfig || safeToBase58Field(pool, 'config', 'config');

        // status + quote vault
        const { status, completed } = safePoolStatus(pool);
        const qv = safeQuoteVault(pool);
        if (!qv) throw new Error('No quote vault found on pool');

        const bal = await connection.getBalance(qv);
        console.log(`  > Vault: ${(bal / LAMPORTS_PER_SOL).toFixed(6)} SOL | Status: ${status} | Completed: ${completed}`);

        if (!completed) throw new Error('Curve not completed');
        if (bal === 0) throw new Error('No leftover SOL');

        // build claim ix (supports many SDK versions)
        const ix = await buildClaimIx(client, { pool, leftoverReceiver, payer: signer.publicKey });
        const tx = new Transaction();
        if (unitLimit) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: unitLimit }));
        if (prio) tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prio }));
        tx.add(ix);
        tx.feePayer = signer.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

        const sig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });
        console.log(`  > ✅ Claimed leftovers. Signature: ${sig}`);
        report.status = 'claimed';
        report.signature = sig;

        results.push(report);
        claimedOrFound = true;
        break; // done with this base mint
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.log(`  > ✖ ${msg}`);
        results.push({ ...report, status: 'error', error: msg });
      }
    }

    if (!claimedOrFound) {
      console.log(`\nNo claimable pool found for ${baseMint.toBase58()} across all configs/programs.`);
    }
  }

  console.log('\nbaseMint,pool,poolConfig,status,signature,error,usedConfig,usedProgram');
  for (const r of results) {
    console.log(
      [
        r.baseMint,
        r.pool || '',
        r.poolConfig || '',
        r.status,
        r.signature || '',
        (r.error || '').replace(/[\r\n,]+/g, ' '),
        r.usedConfig || '',
        r.usedProgram || '',
      ].join(',')
    );
  }
}

main().catch((e) => (console.error(e), process.exit(1)));
