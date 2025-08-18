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

// ---------- Env helper ----------
const env = (k: string): string => {
  const v = process.env[k];
  return (typeof v === 'string' ? v : '').trim();
};

const COMMITMENT: Commitment =
  ((env('COMMITMENT_LEVEL') as Commitment) || 'confirmed') as Commitment;

// ---------- Types ----------
type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
  configUsed?: string;
};

// ---------- Inputs ----------
function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = env('BASE_MINTS');
  if (raw.length === 0) {
    throw new Error('BASE_MINTS is empty. Provide a comma-separated list via workflow input or secret.');
  }
  const mints: PublicKey[] = [];
  const parts = raw.split(',');
  for (const part of parts) {
    const s = part.trim();
    if (s.length === 0) continue;
    mints.push(new PublicKey(s));
  }
  if (mints.length === 0) throw new Error('No valid base mints found in BASE_MINTS.');
  return mints;
}

// ---------- Key loading ----------
function jsonArrayToBytes(jsonStr: string): Uint8Array {
  const parsedUnknown = JSON.parse(jsonStr);
  if (!Array.isArray(parsedUnknown)) throw new Error('keypair.json must be a JSON array of numbers.');
  return Uint8Array.from(parsedUnknown.map((n: number) => Number(n)));
}

function readKeypairJsonFile(p: string): Uint8Array {
  const fp = path.resolve(p);
  if (!fs.existsSync(fp)) throw new Error(`KEYPAIR_PATH not found: ${fp}`);
  const raw = fs.readFileSync(fp, 'utf8').trim();
  const bytes = jsonArrayToBytes(raw);
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
  throw new Error(`keypair.json length ${bytes.length} unsupported (need 32 or 64).`);
}

function getSigner(): Keypair {
  const keypairPath = env('KEYPAIR_PATH');
  if (!keypairPath) throw new Error('KEYPAIR_PATH is required');
  return Keypair.fromSecretKey(readKeypairJsonFile(keypairPath));
}

// ---------- Wallet shim ----------
type MinimalWallet = {
  publicKey: PublicKey;
  payer?: Keypair;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

// ---------- Safe helpers ----------
const safeToBase58Field = (obj: any, primaryField: string, fallbackField: string): string => {
  const p = obj?.[primaryField];
  if (p && typeof p.toBase58 === 'function') return p.toBase58();
  const f = obj?.[fallbackField];
  if (f && typeof f.toBase58 === 'function') return f.toBase58();
  return '(unknown)';
};

const safePoolStatus = (pool: any): { status: string; completed: boolean } => {
  const status: string = pool?.state?.status || pool?.status || '';
  const completed =
    status === 'completed' ||
    status === 'finished' ||
    pool?.state?.isFinished === true ||
    pool?.isFinished === true;
  return { status, completed };
};

const safeQuoteVault = (pool: any): PublicKey | null => {
  const qv = pool?.vaultQuote || pool?.quoteVault || pool?.state?.vaultQuote;
  try {
    return qv ? new PublicKey(qv) : null;
  } catch {
    return null;
  }
};

// ---------- Main ----------
async function main() {
  const rpcUrl = env('RPC_URL') || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, { commitment: COMMITMENT });
  const signer = getSigner();
  const wallet: MinimalWallet = {
    publicKey: signer.publicKey,
    payer: signer,
    signTransaction: async (tx) => { tx.partialSign(signer); return tx; },
    signAllTransactions: async (txs) => { txs.forEach((t) => t.partialSign(signer)); return txs; },
  };

  // Support multiple config keys (comma-separated secret DBC_CONFIG_KEYS)
  const configKeys = (env('DBC_CONFIG_KEYS') || '').split(',').map((c) => c.trim()).filter(Boolean);
  if (configKeys.length === 0) configKeys.push('(default)');

  const baseMints = parseBaseMintsFromEnv();
  const lr = env('LEFTOVER_RECEIVER');
  const leftoverReceiver = lr ? new PublicKey(lr) : signer.publicKey;

  console.log(`> Wallet: ${signer.publicKey.toBase58()}`);
  console.log(`> RPC: ${rpcUrl}`);
  console.log(`> Commitment: ${COMMITMENT}`);
  console.log(`> leftoverReceiver: ${leftoverReceiver.toBase58()}`);
  console.log(`> Base mints: ${baseMints.length}`);
  console.log(`> Config keys: ${configKeys.join(', ')}`);

  const results: LeftoverReport[] = [];

  for (const config of configKeys) {
    const client: any = new (DynamicBondingCurveClient as any)(connection, wallet, config);

    for (const baseMint of baseMints) {
      console.log(`\n— Checking baseMint ${baseMint.toBase58()} on config ${config} ...`);
      const report: LeftoverReport = { baseMint: baseMint.toBase58(), status: 'skipped', configUsed: config };

      try {
        // find pool
        let pool: any | undefined;
        for (const fn of ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool']) {
          const maybeFn = (client as any)[fn];
          if (typeof maybeFn === 'function') {
            pool = await maybeFn.call(client, baseMint);
            if (pool) break;
          }
        }
        if (!pool) throw new Error('DBC pool not found for this base mint.');

        report.pool = safeToBase58Field(pool, 'pubkey', 'address');
        report.poolConfig = safeToBase58Field(pool, 'config', 'config');
        const { status, completed } = safePoolStatus(pool);
        const quoteVaultPk = safeQuoteVault(pool);

        if (!quoteVaultPk) throw new Error('No quote vault on pool.');
        const vaultBal = await connection.getBalance(quoteVaultPk);
        console.log(`  > Vault SOL: ${(vaultBal / LAMPORTS_PER_SOL).toFixed(6)} SOL | Status: ${status} | Completed: ${completed}`);

        if (!completed) throw new Error('Curve not completed.');
        if (vaultBal === 0) throw new Error('No leftover SOL.');

        let ix: any;
        if (typeof client.buildClaimLeftoverInstruction === 'function') {
          ix = await client.buildClaimLeftoverInstruction({ pool, leftoverReceiver, payer: signer.publicKey });
        } else if (typeof client.claimLeftoverInstruction === 'function') {
          ix = await client.claimLeftoverInstruction({ pool, leftoverReceiver, payer: signer.publicKey });
        } else if (typeof client.claimLeftoverBase === 'function') {
          ix = await client.claimLeftoverBase({ poolPublicKey: new PublicKey(report.pool), leftoverReceiver, payer: signer.publicKey });
        } else {
          throw new Error('SDK missing leftover-claim builder.');
        }

        const tx = new Transaction().add(ix);
        tx.feePayer = signer.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;
        const sig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });

        console.log(`  > ✅ Claimed leftovers. Signature: ${sig}`);
        report.status = 'claimed';
        report.signature = sig;
      } catch (e) {
        report.status = 'error';
        report.error = e instanceof Error ? e.message : String(e);
        console.log(`  > ✖ Claim failed: ${report.error}`);
      }
      results.push(report);
    }
  }

  console.log('\nbaseMint,pool,poolConfig,status,signature,error,config');
  for (const r of results) {
    const err = (r.error || '').replace(/[\r\n,]+/g, ' ');
    console.log([r.baseMint, r.pool || '', r.poolConfig || '', r.status, r.signature || '', err, r.configUsed || ''].join(','));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
