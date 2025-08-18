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

// If your repo has a constant, great; otherwise fall back safely.
const COMMITMENT: Commitment =
  (process.env.COMMITMENT_LEVEL as Commitment) || ('confirmed' as Commitment);

type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
};

// Tiny base58 decoder so we don't rely on external deps at runtime.
function base58Decode(input: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = 58;
  if (input.length === 0) return new Uint8Array();
  const bytes: number[] = [0];
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const val = ALPHABET.indexOf(c);
    if (val < 0) throw new Error('Invalid base58 character');
    // multiply by 58 and add val
    for (let j = 0; j < bytes.length; j++) bytes[j] *= BASE;
    bytes[0] += val;
    // carry
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
  // leading zeros
  for (let k = 0; k < input.length && input[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function parseBaseMintsFromEnv(): PublicKey[] {
  const list = (process.env.BASE_MINTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) {
    throw new Error(
      'BASE_MINTS is empty. Paste a comma-separated list into the workflow input.'
    );
  }
  return list.map((m) => new PublicKey(m));
}

function decodeSignerSecret(): Uint8Array {
  // Accept multiple env names for convenience:
  // - PRIVATE_KEY_BASE64 (recommended)
  // - PRIVATE_KEY_B58   (ok)
  // - PRIVATE_KEY       (either base64 or base58)
  // - PRIVATE_KEY_JSON  (JSON array string "[12,34,...]")
  const json = process.env.PRIVATE_KEY_JSON || '';
  if (json) {
    const arr = JSON.parse(json) as number[];
    const bytes = Uint8Array.from(arr);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    throw new Error('PRIVATE_KEY_JSON must be a 32 or 64 byte array.');
  }

  const raw =
    process.env.PRIVATE_KEY_BASE64 ||
    process.env.PRIVATE_KEY_B58 ||
    process.env.PRIVATE_KEY ||
    '';

  if (!raw) {
    throw new Error(
      'Set one of PRIVATE_KEY_BASE64, PRIVATE_KEY_B58, PRIVATE_KEY, or PRIVATE_KEY_JSON.'
    );
  }

  // Try base64 first
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 64) return new Uint8Array(b);
    if (b.length === 32) return nacl.sign.keyPair.fromSeed(new Uint8Array(b)).secretKey;
  } catch {
    // ignore
  }

  // Try base58
  try {
    const b58 = base58Decode(raw);
    if (b58.length === 64) return b58;
    if (b58.length === 32) return nacl.sign.keyPair.fromSeed(b58).secretKey;
  } catch {
    // ignore
  }

  throw new Error(
    'Could not decode signer secret. Provide 64-byte base64/base58 secret key, 32-byte seed, or JSON array.'
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
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
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

  // Construct the DBC client but keep it fully dynamic to sidestep TS type drift across versions.
  const client: any = new (DynamicBondingCurveClient as any)(connection, wallet);

  const baseMints = parseBaseMintsFromEnv();
  const leftoverReceiver =
    (process.env.LEFTOVER_RECEIVER && new PublicKey(process.env.LEFTOVER_RECEIVER)) ||
    signer.publicKey;

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
      // Work across SDK variants
      let pool: any | undefined;
      const candFns = ['getPoolByBaseMint', 'fetchPoolByBaseMint', 'getPool'];
      for (const fn of candFns) {
        if (typeof client[fn] === 'function') {
          pool = await client[fn](baseMint);
          if (pool) break;
        }
      }
      if (!pool) throw new Error('DBC pool not found for this base mint.');

      report.pool = pool?.pubkey?.toBase58?.() ?? pool?.address?.toBase58?.() ?? '(unknown)';
      report.poolConfig = pool?.config?.toBase58?.() ?? '(unknown)';

      const status = pool?.state?.status ?? pool?.status ?? '';
      const isCompleted =
        status === 'completed' ||
        status === 'finished' ||
        pool?.state?.isFinished === true ||
        pool?.isFinished === true;

      const quoteVaultPk: PublicKey | undefined =
        pool?.vaultQuote ?? pool?.quoteVault ?? pool?.state?.vaultQuote;

      if (!quoteVaultPk) {
        console.log('  > No quote vault on pool; skipping.');
        results.push(report);
        continue;
      }

      const vaultBal = await connection.getBalance(new PublicKey(quoteVaultPk));
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
