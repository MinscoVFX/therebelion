// studio/src/scripts/dbc/claim_leftovers.ts
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

// ---------- Env helper (always returns a string) ----------
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
};

// ---------- Inputs ----------
function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = env('BASE_MINTS');
  const parts = raw.length > 0 ? raw.split(',') : [];
  const list: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i].trim();
    if (s.length > 0) list.push(s);
  }
  if (list.length === 0) {
    throw new Error('BASE_MINTS is empty. Provide a comma-separated list via workflow input or secret.');
  }
  const mints: PublicKey[] = [];
  for (let i = 0; i < list.length; i++) {
    mints.push(new PublicKey(list[i]));
  }
  return mints;
}

// ---------- Key loading (from keypair.json only) ----------
// (Keep this super explicit so TS never thinks something might be undefined.)
function jsonArrayToBytes(jsonStr: string): Uint8Array {
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(jsonStr);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse keypair JSON: ${msg}`);
  }

  if (!Array.isArray(parsedUnknown)) {
    throw new Error('keypair.json must be a JSON array of numbers.');
  }
  const parsedArr: unknown[] = parsedUnknown as unknown[];

  const out: number[] = [];
  for (let i = 0; i < parsedArr.length; i++) {
    const v = parsedArr[i];
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 255) {
      throw new Error('keypair.json must contain byte values (0..255).');
    }
    out.push(n);
  }
  return Uint8Array.from(out);
}

function readKeypairJsonFile(p: string): Uint8Array {
  const fp = path.resolve(p);
  const exists = fs.existsSync(fp);
  if (!exists) throw new Error(`KEYPAIR_PATH not found: ${fp}`);

  const raw = fs.readFileSync(fp, 'utf8');
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) {
    throw new Error(`keypair.json is empty at ${fp}`);
  }

  const bytes = jsonArrayToBytes(trimmed);
  const len = bytes.length;
  if (len === 64) return bytes;
  if (len === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
  throw new Error(`keypair.json length ${len} unsupported (need 32 or 64).`);
}

function getSigner(): Keypair {
  const keypairPath = env('KEYPAIR_PATH');
  if (keypairPath.length === 0) {
    throw new Error(
      'KEYPAIR_PATH is required. Your workflow should create keypair.json from base58 and set KEYPAIR_PATH=./keypair.json.'
    );
  }
  const secret = readKeypairJsonFile(keypairPath);
  return Keypair.fromSecretKey(secret);
}

// ---------- Wallet shim ----------
type MinimalWallet = {
  publicKey: PublicKey;
  payer?: Keypair;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

// ---------- Main ----------
async function main() {
  const rpcUrlRaw = env('RPC_URL');
  const rpcUrl = rpcUrlRaw.length > 0 ? rpcUrlRaw : 'https://api.mainnet-beta.solana.com';

  const connection = new Connection(rpcUrl, { commitment: COMMITMENT });

  const signer = getSigner();
  const wallet: MinimalWallet = {
    publicKey: signer.publicKey,
    payer: signer,
    signTransaction: async (tx) => {
      tx.partialSign(signer);
      return tx;
    },
    signAllTransactions: async (txs) => {
      for (let i = 0; i < txs.length; i++) {
        txs[i].partialSign(signer);
      }
      return txs;
    },
  };

  // Use dynamic any to avoid SDK type drift
  const client: any = new (DynamicBondingCurveClient as any)(connection, wallet);

  const baseMints = parseBaseMintsFromEnv();
  const lr = env('LEFTOVER_RECEIVER');
  const leftoverReceiver = lr.length > 0 ? new PublicKey(lr) : signer.publicKey;

  console.log(`> Wallet: ${signer.publicKey.toBase58()}`);
  console.log(`> RPC: ${rpcUrl}`);
  console.log(`> Commitment: ${COMMITMENT}`);
  console.log(`> leftoverReceiver: ${leftoverReceiver.toBase58()}`);
  console.log(`> Base mints: ${baseMints.length}`);

  const results: LeftoverReport[] = [];

  for (let i = 0; i < baseMints.length; i++) {
    const baseMint = baseMints[i];
    console.log(`\n— Checking baseMint ${baseMint.toBase58()} ...`);
    const report: LeftoverReport = { baseMint: baseMint.toBase58(), status: 'skipped' };

    try {
      // Try common helper names across SDK versions
      let pool: any | undefined;
      const candFns = ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool'];
      for (let j = 0; j < candFns.length; j++) {
        const fn = candFns[j];
        const maybeFn = (client as any)[fn];
        if (typeof maybeFn === 'function') {
          // eslint-disable-next-line @typescript-eslint/await-thenable
          const p = await maybeFn.call(client, baseMint);
          if (p) {
            pool = p;
            break;
          }
        }
      }
      if (!pool) throw new Error('DBC pool not found for this base mint.');

      // Defensive access on pool fields
      const poolPub =
        (pool && pool.pubkey && typeof pool.pubkey.toBase58 === 'function' && pool.pubkey.toBase58()) ||
        (pool && pool.address && typeof pool.address.toBase58 === 'function' && pool.address.toBase58()) ||
        '(unknown)';
      const poolCfg =
        (pool && pool.config && typeof pool.config.toBase58 === 'function' && pool.config.toBase58()) ||
        '(unknown)';
      report.pool = typeof poolPub === 'string' ? poolPub : '(unknown)';
      report.poolConfig = typeof poolCfg === 'string' ? poolCfg : '(unknown)';

      const statusVal: string =
        (pool && pool.state && typeof pool.state.status === 'string' && pool.state.status) ||
        (typeof pool?.status === 'string' ? (pool.status as string) : '') ||
        '';

      const isCompleted =
        statusVal === 'completed' ||
        statusVal === 'finished' ||
        (pool && pool.state && pool.state.isFinished === true) ||
        (pool && pool.isFinished === true);

      const qvCandidate =
        (pool && (pool as any).vaultQuote) ||
        (pool && (pool as any).quoteVault) ||
        (pool && (pool as any).state && (pool as any).state.vaultQuote) ||
        null;

      if (!qvCandidate) {
        console.log('  > No quote vault on pool; skipping.');
        results.push(report);
        continue;
      }

      const quoteVaultPk = new PublicKey(qvCandidate);
      const vaultBal = await connection.getBalance(quoteVaultPk);
      console.log(`  > Vault SOL: ${(vaultBal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      console.log(`  > Status: ${statusVal || '(unknown)'} | Completed: ${isCompleted}`);

      if (!isCompleted) {
        console.log('  > Curve not completed; skipping.');
        results.push(report);
        continue;
      }
      if (vaultBal === 0) {
        console.log('  > No leftover SOL; skipping.');
        results.push(report);
        continue;
      }

      let ix: any;
      if (typeof (client as any).buildClaimLeftoverInstruction === 'function') {
        ix = await (client as any).buildClaimLeftoverInstruction({
          pool,
          leftoverReceiver,
          payer: signer.publicKey,
        });
      } else if (typeof (client as any).claimLeftoverInstruction === 'function') {
        ix = await (client as any).claimLeftoverInstruction({
          pool,
          leftoverReceiver,
          payer: signer.publicKey,
        });
      } else if (typeof (client as any).claimLeftoverBase === 'function') {
        ix = await (client as any).claimLeftoverBase({
          poolPublicKey: new PublicKey(report.pool!),
          leftoverReceiver,
          payer: signer.publicKey,
        });
      } else {
        throw new Error('SDK missing leftover-claim builder on this version. Update @meteora-ag/dynamic-bonding-curve-sdk.');
      }

      const tx = new Transaction().add(ix);
      tx.feePayer = signer.publicKey;
      const blockhash = await connection.getLatestBlockhash('finalized');
      tx.recentBlockhash = blockhash.blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [signer], {
        commitment: 'confirmed',
        skipPreflight: false,
      });

      console.log(`  > ✅ Claimed leftovers. Signature: ${sig}`);
      report.status = 'claimed';
      report.signature = sig;
      results.push(report);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const short = msg.length > 240 ? msg.slice(0, 240) : msg;
      console.log(`  > ✖ Claim failed: ${short}`);
      report.status = 'error';
      report.error = short;
      results.push(report);
    }
  }

  console.log('\nbaseMint,pool,poolConfig,status,signature,error');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const err = (r.error || '').replace(/[\r\n,]+/g, ' ');
    console.log([r.baseMint, r.pool || '', r.poolConfig || '', r.status, r.signature || '', err].join(','));
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
