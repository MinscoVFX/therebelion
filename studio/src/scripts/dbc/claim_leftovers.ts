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
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (list.length === 0) {
    throw new Error('BASE_MINTS is empty. Provide a comma-separated list via workflow input or secret.');
  }
  return list.map((m) => new PublicKey(m));
}

// ---------- Key loading (from keypair.json only) ----------
function jsonArrayToBytes(jsonStr: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse keypair JSON: ${msg}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('keypair.json must be a JSON array of numbers.');
  }
  const arr: number[] = [];
  for (const v of parsed) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 255) {
      throw new Error('keypair.json must contain byte values (0..255).');
    }
    arr.push(n);
  }
  return Uint8Array.from(arr);
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
  const rpcUrl = env('RPC_URL') || 'https://api.mainnet-beta.solana.com';
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
      txs.forEach((t) => t.partialSign(signer));
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

  for (const baseMint of baseMints) {
    console.log(`\n— Checking baseMint ${baseMint.toBase58()} ...`);
    const report: LeftoverReport = { baseMint: baseMint.toBase58(), status: 'skipped' };

    try {
      // Try common helper names across SDK versions
      let pool: any | undefined;
      const candFns = ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool'];
      for (const fn of candFns) {
        const maybeFn = (client as any)[fn];
        if (typeof maybeFn === 'function') {
          const p = await maybeFn.call(client, baseMint);
          if (p) {
            pool = p;
            break;
          }
        }
      }
      if (!pool) throw new Error('DBC pool not found for this base mint.');

      report.pool = pool?.pubkey?.toBase58?.() ?? pool?.address?.toBase58?.() ?? '(unknown)';
      report.poolConfig = pool?.config?.toBase58?.() ?? '(unknown)';

      const statusVal = (pool?.state?.status ?? pool?.status ?? '') as string;
      const isCompleted =
        statusVal === 'completed' ||
        statusVal === 'finished' ||
        (pool?.state?.isFinished === true) ||
        (pool?.isFinished === true);

      const qvCandidate =
        (pool as any)?.vaultQuote ??
        (pool as any)?.quoteVault ??
        (pool as any)?.state?.vaultQuote ??
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
      if (typeof client.buildClaimLeftoverInstruction === 'function') {
        ix = await client.buildClaimLeftoverInstruction({
          pool,
          leftoverReceiver,
          payer: signer.publicKey,
        });
      } else if (typeof client.claimLeftoverInstruction === 'function') {
        ix = await client.claimLeftoverInstruction({
          pool,
          leftoverReceiver,
          payer: signer.publicKey,
        });
      } else if (typeof client.claimLeftoverBase === 'function') {
        ix = await client.claimLeftoverBase({
          poolPublicKey: new PublicKey(report.pool!),
          leftoverReceiver,
          payer: signer.publicKey,
        });
      } else {
        throw new Error('SDK missing leftover-claim builder on this version. Update @meteora-ag/dynamic-bonding-curve-sdk.');
      }

      const tx = new Transaction().add(ix);
      tx.feePayer = signer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash;

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
      console.log(`  > ✖ Claim failed: ${msg.slice(0, 240)}`);
      report.status = 'error';
      report.error = msg.slice(0, 240);
      results.push(report);
    }
  }

  console.log('\nbaseMint,pool,poolConfig,status,signature,error');
  for (const r of results) {
    console.log(
      [
        r.baseMint,
        r.pool || '',
        r.poolConfig || '',
        r.status,
        r.signature || '',
        (r.error || '').replace(/[\r\n,]+/g, ' '),
      ].join(',')
    );
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
