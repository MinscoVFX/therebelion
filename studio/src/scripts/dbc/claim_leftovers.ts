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
const env = (k: string): string => (process.env[k] || '').trim();

const COMMITMENT: Commitment = (env('COMMITMENT_LEVEL') as Commitment) || 'confirmed';

// ---------- Types ----------
type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
};

// ---------- Inputs ----------
function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = env('BASE_MINTS');
  if (!raw) throw new Error('BASE_MINTS is empty.');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => new PublicKey(s));
}

// ---------- Keypair ----------
function jsonArrayToBytes(raw: string): Uint8Array {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid keypair.json format');
  return Uint8Array.from(parsed.map((n: any) => Number(n)));
}
function readKeypairJsonFile(p: string): Uint8Array {
  const raw = fs.readFileSync(path.resolve(p), 'utf8');
  const bytes = jsonArrayToBytes(raw);
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
  throw new Error(`Unsupported key length ${bytes.length}`);
}
function getSigner(): Keypair {
  const keypairPath = env('KEYPAIR_PATH');
  if (!keypairPath) throw new Error('KEYPAIR_PATH required');
  return Keypair.fromSecretKey(readKeypairJsonFile(keypairPath));
}

// ---------- Wallet ----------
type MinimalWallet = {
  publicKey: PublicKey;
  payer?: Keypair;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

// ---------- Helpers ----------
function safeToBase58Field(obj: any, primary: string, fallback: string): string {
  const field = obj?.[primary] || obj?.[fallback];
  if (field && typeof field.toBase58 === 'function') return field.toBase58();
  return '';
}
function safePoolStatus(pool: any) {
  const status = pool?.state?.status || pool?.status || '';
  const completed = status === 'completed' || status === 'finished' || pool?.state?.isFinished === true;
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

// ---------- Main ----------
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

  const client: any = new (DynamicBondingCurveClient as any)(connection, wallet);
  const baseMints = parseBaseMintsFromEnv();

  const lr = env('LEFTOVER_RECEIVER');
  const leftoverReceiver = lr ? new PublicKey(lr) : signer.publicKey;

  console.log(`Wallet: ${signer.publicKey.toBase58()}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Commitment: ${COMMITMENT}`);
  console.log(`Receiver: ${leftoverReceiver.toBase58()}`);
  console.log(`Base mints: ${baseMints.length}`);

  const results: LeftoverReport[] = [];

  for (const baseMint of baseMints) {
    const report: LeftoverReport = { baseMint: baseMint.toBase58(), status: 'skipped' };
    try {
      let pool: any;
      for (const fn of ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool']) {
        if (typeof client[fn] === 'function') {
          pool = await client[fn](baseMint);
          if (pool) break;
        }
      }
      if (!pool) throw new Error('DBC pool not found for this base mint.');

      report.pool = safeToBase58Field(pool, 'pubkey', 'address');
      report.poolConfig = safeToBase58Field(pool, 'config', 'config');
      const { status, completed } = safePoolStatus(pool);

      const vault = safeQuoteVault(pool);
      if (!vault) throw new Error('No quote vault found');
      const bal = await connection.getBalance(vault);

      if (!completed || bal === 0) throw new Error('Nothing claimable');

      let ix: any;
      if (client.buildClaimLeftoverInstruction) {
        ix = await client.buildClaimLeftoverInstruction({ pool, leftoverReceiver, payer: signer.publicKey });
      } else if (client.claimLeftoverInstruction) {
        ix = await client.claimLeftoverInstruction({ pool, leftoverReceiver, payer: signer.publicKey });
      } else if (client.claimLeftoverBase) {
        ix = await client.claimLeftoverBase({ poolPublicKey: new PublicKey(report.pool), leftoverReceiver, payer: signer.publicKey });
      } else throw new Error('No leftover claim fn in SDK');

      const tx = new Transaction().add(ix);
      tx.feePayer = signer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });
      report.status = 'claimed';
      report.signature = sig;
      console.log(`Claimed ${bal / LAMPORTS_PER_SOL} SOL -> ${sig}`);
    } catch (e: any) {
      report.status = 'error';
      report.error = e.message || String(e);
      console.log(`Error: ${report.error}`);
    }
    results.push(report);
  }

  console.log('\nbaseMint,pool,poolConfig,status,signature,error');
  for (const r of results) {
    console.log([r.baseMint, r.pool || '', r.poolConfig || '', r.status, r.signature || '', (r.error || '').replace(/[\r\n,]+/g, ' ')].join(','));
  }
}
main().catch((e) => (console.error(e), process.exit(1)));
