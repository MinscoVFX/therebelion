/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  type Commitment,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as nacl from 'tweetnacl';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

/* --------------------------------- env ---------------------------------- */

const env = (k: string): string => (process.env[k] || '').trim();
const COMMITMENT: Commitment = (env('COMMITMENT_LEVEL') as Commitment) || 'confirmed';

/* --------------------------------- types -------------------------------- */

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

/* ------------------------------ inputs/env ------------------------------ */

function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = env('BASE_MINTS');
  if (!raw) throw new Error('BASE_MINTS is empty.');
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('No valid base mints found in BASE_MINTS.');
  return parts.map((s) => new PublicKey(s));
}

function parseConfigKeys(): string[] {
  const raw = env('DBC_CONFIG_KEYS');
  if (!raw) return ['(default)'];
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : ['(default)'];
}

function parseProgramIds(): (PublicKey | null)[] {
  const raw = env('DBC_PROGRAM_IDS');
  if (!raw) return [null];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return [null];
  const out: (PublicKey | null)[] = [];
  for (const p of parts) {
    try {
      out.push(new PublicKey(p));
    } catch {
      // ignore invalid entry
    }
  }
  return out.length ? out : [null];
}

/* -------------------------------- keypair ------------------------------- */

function jsonArrayToBytes(raw: string): Uint8Array {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid keypair.json format');
  const out: number[] = [];
  for (const v of parsed) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 255) {
      throw new Error('keypair.json must be an array of bytes (0..255)');
    }
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

/* -------------------------------- wallet -------------------------------- */

type MinimalWallet = {
  publicKey: PublicKey;
  payer?: Keypair;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

/* ------------------------------- helpers -------------------------------- */

function safeToBase58Field(obj: any, primary: string, fallback: string): string {
  const field = obj?.[primary] || obj?.[fallback];
  if (field && typeof field.toBase58 === 'function') return field.toBase58();
  if (typeof field === 'string') {
    try {
      return new PublicKey(field).toBase58();
    } catch {
      /* ignore */
    }
  }
  return '';
}

function safePoolStatus(pool: any) {
  // normalize status across sdk versions
  const status: string | undefined =
    pool?.state?.status ?? pool?.status ?? pool?.state?.rawStatus ?? pool?.rawStatus;
  const completed =
    status === 'completed' ||
    status === 'finished' ||
    pool?.state?.isFinished === true ||
    pool?.isFinished === true;
  return { status, completed };
}

function safeQuoteVault(pool: any): PublicKey | null {
  const qv = pool?.vaultQuote || pool?.quoteVault || pool?.state?.vaultQuote;
  try {
    return qv ? new PublicKey(qv) : null;
  } catch {
    return null;
  }
}

/**
 * Build candidate clients for every (configKey × programId) combo.
 * Keep ctor permissive to survive sdk signature changes.
 */
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
        // Common constructor shapes:
        // new Client(conn, wallet)
        // new Client(conn, wallet, configKey)
        // (programId is often a field, not a ctor arg)
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

/** Try several sdk method names (across versions) to fetch a pool by baseMint. */
async function fetchPoolByBaseMint(client: any, baseMint: PublicKey): Promise<any | null> {
  for (const fn of ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool']) {
    const f = client?.[fn];
    if (typeof f === 'function') {
      try {
        const p = await f.call(client, baseMint);
        if (p) return p;
      } catch {
        // try next name
      }
    }
  }
  // fallback: scan lists if exposed by this sdk build
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

/* --------------------------------- main --------------------------------- */

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

  console.log(`Wallet: ${signer.publicKey.toBase58()}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Commitment: ${COMMITMENT}`);
  console.log(`Receiver: ${leftoverReceiver.toBase58()}`);
  console.log(`Base mints: ${baseMints.length}`);
  console.log(`Config keys: ${configKeys.join(', ')}`);
  console.log(`Program IDs: ${programIds.map((p) => (p ? p.toBase58() : '(default)')).join(', ')}`);

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
        const pool = await fetchPoolByBaseMint(client, baseMint);
        if (!pool) {
          console.log('  > No pool with this base mint on this config/program.');
          results.push({ ...report, status: 'error', error: 'Pool not found for this combo' });
          continue;
        }

        report.pool = safeToBase58Field(pool, 'pubkey', 'address');
        report.poolConfig = safeToBase58Field(pool, 'config', 'config');

        const { status, completed } = safePoolStatus(pool);
        const qv = safeQuoteVault(pool);
        if (!qv) throw new Error('No quote vault found on pool');

        const bal = await connection.getBalance(qv);
        console.log(
          `  > Vault: ${(bal / LAMPORTS_PER_SOL).toFixed(6)} SOL | Status: ${status ?? 'unknown'} | Completed: ${completed}`
        );

        if (!completed) throw new Error('Curve not completed');
        if (bal === 0) throw new Error('No leftover SOL');

        // Build claim instruction (sdk method name varies by version)
        let ix: any;
        if (typeof client.buildClaimLeftoverInstruction === 'function') {
          ix = await client.buildClaimLeftoverInstruction({ pool, leftoverReceiver, payer: signer.publicKey });
        } else if (typeof client.claimLeftoverInstruction === 'function') {
          ix = await client.claimLeftoverInstruction({ pool, leftoverReceiver, payer: signer.publicKey });
        } else if (typeof client.claimLeftoverBase === 'function') {
          ix = await client.claimLeftoverBase({
            poolPublicKey: new PublicKey(report.pool || pool?.pubkey || pool?.address),
            leftoverReceiver,
            payer: signer.publicKey,
          });
        } else {
          throw new Error('SDK has no leftover claim builder in this version');
        }

        const tx = new Transaction().add(ix);
        tx.feePayer = signer.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

        const sig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });
        console.log(`  > ✅ Claimed leftovers. Signature: ${sig}`);
        report.status = 'claimed';
        report.signature = sig;

        results.push(report);
        claimedOrFound = true;
        break; // stop trying other combos for this base mint
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
