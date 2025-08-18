// studio/src/scripts/dbc/claim_leftovers.ts

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { Wallet as AnchorWallet } from '@coral-xyz/anchor';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

// Import ONLY the helper we use (to avoid arg-count/type mismatches)
import { safeParseKeypairFromFile } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';

type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
};

function parseBaseMintsFromEnv(): PublicKey[] {
  const list = (process.env.BASE_MINTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) {
    throw new Error(
      'BASE_MINTS is empty. Set a comma-separated list of base mints in Actions inputs or secrets.'
    );
  }
  return list.map((m) => new PublicKey(m));
}

async function getSigner(): Promise<Keypair> {
  // Priority: PRIVATE_KEY_B58 -> KEYPAIR_PATH (same pattern as your other scripts)
  const b64 = process.env.PRIVATE_KEY_B58 || '';
  if (b64) {
    const secret = Uint8Array.from(Buffer.from(b64, 'base64'));
    return Keypair.fromSecretKey(secret);
  }
  // Your helper expects 0 args — do NOT pass anything.
  const kp = await safeParseKeypairFromFile();
  return kp;
}

async function main() {
  // No CLI helper here — everything is driven by env: RPC_URL, BASE_MINTS, LEFTOVER_RECEIVER, PRIVATE_KEY_B58

  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, { commitment: DEFAULT_COMMITMENT_LEVEL });

  const signer = await getSigner();
  const wallet = new AnchorWallet(signer);

  // Use constructor; cast to any to smooth over SDK version differences
  const client: any = new (DynamicBondingCurveClient as any)(connection, wallet);

  // Required inputs
  const baseMints = parseBaseMintsFromEnv();

  // Optional override; default to signer
  const leftoverReceiver =
    (process.env.LEFTOVER_RECEIVER && new PublicKey(process.env.LEFTOVER_RECEIVER)) ||
    signer.publicKey;

  console.log(`> Claiming leftovers with wallet ${signer.publicKey.toBase58()}`);
  console.log(`> RPC: ${rpcUrl}`);
  console.log(`> leftoverReceiver: ${leftoverReceiver.toBase58()}`);
  console.log(`> Base mints to scan: ${baseMints.length}`);

  const results: LeftoverReport[] = [];

  for (const baseMint of baseMints) {
    console.log(`\n— Checking baseMint ${baseMint.toBase58()} ...`);
    const report: LeftoverReport = { baseMint: baseMint.toBase58(), status: 'skipped' };

    try {
      // Try common SDK helper names across versions
      let pool: any | undefined;
      if (typeof client.getPoolByBaseMint === 'function') {
        pool = await client.getPoolByBaseMint(baseMint);
      } else if (typeof client.fetchPoolByBaseMint === 'function') {
        pool = await client.fetchPoolByBaseMint(baseMint);
      } else if (typeof client.getPool === 'function') {
        pool = await client.getPool(baseMint);
      }

      if (!pool) throw new Error('DBC Pool not found for this base mint.');

      report.pool = pool?.pubkey?.toBase58?.() ?? pool?.address?.toBase58?.() ?? '(unknown)';
      report.poolConfig = pool?.config?.toBase58?.() ?? '(unknown)';

      // Determine completion/finished status across SDK variants
      const status = pool?.state?.status ?? pool?.status ?? '';
      const isCompleted =
        status === 'completed' ||
        status === 'finished' ||
        pool?.state?.isFinished === true ||
        pool?.isFinished === true;

      // Locate the quote (SOL) vault
      const quoteVaultPk =
        (pool as any)?.vaultQuote ??
        (pool as any)?.quoteVault ??
        (pool as any)?.state?.vaultQuote;

      if (!quoteVaultPk) {
        console.log('  > No quote vault field on pool; skipping.');
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

      // Build claim instruction using whichever helper exists in this SDK version
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
          'SDK version missing a leftover-claim builder. Update @meteora-ag/dynamic-bonding-curve-sdk.'
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

  // CSV-ish summary for Actions logs/artifacts
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
