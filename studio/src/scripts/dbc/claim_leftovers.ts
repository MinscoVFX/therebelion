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
import * as nacl from 'tweetnacl';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

// env() always returns a string (never undefined), satisfying strict null checks.
const env = (k: string): string => {
  const v = process.env[k];
  return (typeof v === 'string' ? v : '').trim();
};

const COMMITMENT: Commitment = ((env('COMMITMENT_LEVEL') as Commitment) || 'confirmed') as Commitment;

type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
};

// Minimal base58 decoder without any index-based string access (avoids undefined reads)
function base58Decode(inputRaw: string): Uint8Array {
  const input = inputRaw || '';
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = 58;

  if (input.length === 0) return new Uint8Array();

  const bytes: number[] = [0];
  for (const ch of input) {
    const val = ALPHABET.indexOf(ch);
    if (val < 0) throw new Error('Invalid base58 character');
    // multiply by 58
    for (let i = 0; i < bytes.length; i++) bytes[i] *= BASE;
    // add digit
    bytes[0] += val;
    // carry
    let carry = 0;
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] += carry;
      carry = bytes[i] >> 8;
      bytes[i] &= 0xff;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Count leading zeros
  let leadingZeros = 0;
  for (const ch of input) {
    if (ch === '1') leadingZeros++;
    else break;
  }
  for (let i = 0; i < leadingZeros; i++) bytes.push(0);

  bytes.reverse();
  return new Uint8Array(bytes);
}

function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = env('BASE_MINTS');
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (list.length === 0) {
    throw new Error(
      'BASE_MINTS is empty. Provide a comma-separated list via workflow input or secret.'
    );
  }
  return list.map((m) => new PublicKey(m));
}

// Safe JSON array -> Uint8Array guard
function jsonArrayToBytes(jsonStr: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse JSON: ${msg}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of numbers.');
  }
  const arr: number[] = [];
  for (const v of parsed) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 255) {
      throw new Error('JSON array must contain byte values (0..255).');
    }
    arr.push(n);
  }
  return Uint8Array.from(arr);
}

function decodeSignerSecret(): Uint8Array {
  const jsonStr = env('PRIVATE_KEY_JSON');
  if (jsonStr.length > 0) {
    const bytes = jsonArrayToBytes(jsonStr);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    throw new Error(`PRIVATE_KEY_JSON length ${bytes.length} unsupported (need 32 or 64).`);
  }

  const rawB64 = env('PRIVATE_KEY_BASE64');
  if (rawB64.length > 0) {
    const buf = Buffer.from(rawB64, 'base64'); // always a Buffer
    const bytes = new Uint8Array(buf);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    throw new Error(`PRIVATE_KEY_BASE64 length ${bytes.length} unsupported (need 32 or 64).`);
  }

  const rawB58 = env('PRIVATE_KEY_B58');
  if (rawB58.length > 0) {
    const bytes = base58Decode(rawB58);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    throw new Error(`PRIVATE_KEY_B58 length ${bytes.length} unsupported (need 32 or 64).`);
  }

  const rawAny = env('PRIVATE_KEY');
  if (rawAny.length > 0) {
    // Try JSON array first
    try {
      const bytes = jsonArrayToBytes(rawAny);
      if (bytes.length === 64) return bytes;
      if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    } catch {
      // not JSON array
    }
    // Try base64
    try {
      const b = Buffer.from(rawAny, 'base64');
      const bytes = new Uint8Array(b);
      if (bytes.length === 64) return bytes;
      if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    } catch {
      // not base64
    }
    // Try base58
    try {
      const bytes = base58Decode(rawAny);
      if (bytes.length === 64) return bytes;
      if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    } catch {
      // not base58
    }
    throw new Error(
      'PRIVATE_KEY provided, but format not recognized (JSON array, base64, or base58).'
    );
  }

  throw new Error(
    'Missing signer secret. Set one of: PRIVATE_KEY_BASE64, PRIVATE_KEY_B58, PRIVATE_KEY_JSON, or PRIVATE_KEY.'
  );
}

function getSigner(): Keypair {
  const secret = decodeSignerSecret();
  return Keypair.fromSecretKey(secret);
}

type MinimalWallet = {
  publicKey: PublicKey;
  payer?: Keypair;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

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

  // Keep it dynamic to avoid SDK type drift issues
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
        throw new Error(
          'SDK missing leftover-claim builder on this version. Update @meteora-ag/dynamic-bonding-curve-sdk.'
        );
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
