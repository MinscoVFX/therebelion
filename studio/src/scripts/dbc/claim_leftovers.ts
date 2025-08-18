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

const COMMITMENT: Commitment =
  ((process.env.COMMITMENT_LEVEL as Commitment) ?? 'confirmed') as Commitment;

type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
};

// Minimal base58 decoder (avoids external deps)
function base58Decode(input: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = 58;
  if (input.length === 0) return new Uint8Array();
  const bytes: number[] = [0];
  for (let i = 0; i < input.length; i++) {
    const val = ALPHABET.indexOf(input[i]);
    if (val < 0) throw new Error('Invalid base58 character');
    for (let j = 0; j < bytes.length; j++) bytes[j] *= BASE;
    bytes[0] += val;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < input.length && input[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = process.env.BASE_MINTS ?? '';
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

function decodeSignerSecret(): Uint8Array {
  const jsonStr = process.env.PRIVATE_KEY_JSON;
  if (jsonStr && jsonStr.trim().length > 0) {
    try {
      const parsed = JSON.parse(jsonStr.trim());
      if (Array.isArray(parsed)) {
        const bytes = Uint8Array.from(parsed as number[]);
        if (bytes.length === 64) return bytes;
        if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
      }
      throw new Error('PRIVATE_KEY_JSON must be a JSON array of 32 or 64 numbers.');
    } catch (e: any) {
      throw new Error(`Failed to parse PRIVATE_KEY_JSON: ${e?.message ?? e}`);
    }
  }

  const rawB64 = process.env.PRIVATE_KEY_BASE64 ?? '';
  if (rawB64.length > 0) {
    const b = Buffer.from(rawB64, 'base64');
    const bytes = new Uint8Array(b);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    throw new Error(`PRIVATE_KEY_BASE64 length ${bytes.length} unsupported (need 32 or 64).`);
  }

  const rawB58 = process.env.PRIVATE_KEY_B58 ?? '';
  if (rawB58.length > 0) {
    const bytes = base58Decode(rawB58);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    throw new Error(`PRIVATE_KEY_B58 length ${bytes.length} unsupported (need 32 or 64).`);
  }

  const rawAny = process.env.PRIVATE_KEY ?? '';
  if (rawAny.length > 0) {
    // Try JSON
    try {
      const parsed = JSON.parse(rawAny);
      if (Array.isArray(parsed)) {
        const bytes = Uint8Array.from(parsed as number[]);
        if (bytes.length === 64) return bytes;
        if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
      }
    } catch {
      // not JSON
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
      'PRIVATE_KEY provided, but format not recognized (expected JSON array, base64, or base58).'
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
  const rpcUrl = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
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

  const client: any = new (DynamicBondingCurveClient as any)(connection, wallet);

  const baseMints = parseBaseMintsFromEnv();

  const lr = process.env.LEFTOVER_RECEIVER ?? '';
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
      let pool: any | undefined;
      const candFns = ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool'];
      for (const fn of candFns) {
        const maybe = (client as any)[fn];
        if (typeof maybe === 'function') {
          const p = await maybe.call(client, baseMint);
          if (p) {
            pool = p;
            break;
          }
        }
      }
      if (!pool) throw new Error('DBC pool not found for this base mint.');

      report.pool = pool?.pubkey?.toBase58?.() ?? pool?.address?.toBase58?.() ?? '(unknown)';
      report.poolConfig = pool?.config?.toBase58?.() ?? '(unknown)';

      const status: string = (pool?.state?.status ?? pool?.status ?? '') as string;
      const isCompleted =
        status === 'completed' ||
        status === 'finished' ||
        pool?.state?.isFinished === true ||
        pool?.isFinished === true;

      const qv: PublicKey | undefined =
        (pool as any)?.vaultQuote ??
        (pool as any)?.quoteVault ??
        (pool as any)?.state?.vaultQuote;

      if (!qv) {
        console.log('  > No quote vault on pool; skipping.');
        results.push(report);
        continue;
      }

      const vaultBal = await connection.getBalance(new PublicKey(qv));
      console.log(`  > Vault SOL: ${(vaultBal / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      console.log(`  > Status: ${status || '(unknown)'} | Completed: ${isCompleted}`);

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

      let ix;
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
    } catch (e: any) {
      const msg = (e?.message || String(e)).slice(0, 240);
      console.log(`  > ✖ Claim failed: ${msg}`);
      report.status = 'error';
      report.error = msg;
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
