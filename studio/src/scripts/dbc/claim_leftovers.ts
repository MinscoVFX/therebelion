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

import { parseConfigFromCli, safeParseKeypairFromFile } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import type { DbcConfig } from '../../utils/types';

type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
};

function parseBaseMintsFromEnv(): PublicKey[] {
  const env = (process.env.BASE_MINTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return env.map((s) => new PublicKey(s));
}

async function getSigner(): Promise<Keypair> {
  // Priority: PRIVATE_KEY_B58 -> KEYPAIR_PATH (same as your other scripts)
  const b58 = process.env.PRIVATE_KEY_B58 || '';
  if (b58) {
    try {
      const bs = Uint8Array.from(Buffer.from(b58, 'base64'));
      return Keypair.fromSecretKey(bs);
    } catch (e) {
      throw new Error('Invalid PRIVATE_KEY_B58 (expected base64-encoded secret key bytes).');
    }
  }
  const kp = await safeParseKeypairFromFile();
  return kp;
}

async function main() {
  const cfg: DbcConfig = await parseConfigFromCli('Using config file:');
  const DBC_CONFIG_KEY = process.env.DBC_CONFIG_KEY || cfg?.dbcConfigKey || '';
  if (!DBC_CONFIG_KEY) throw new Error('DBC_CONFIG_KEY is empty. Set it in repo secrets or config file.');

  const rpcUrl =
    process.env.RPC_URL ||
    cfg?.rpc ||
    'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, { commitment: DEFAULT_COMMITMENT_LEVEL });

  const signer = await getSigner();
  const wallet = new AnchorWallet(signer);

  const client = await DynamicBondingCurveClient.load(connection, wallet);

  // Prefer explicit list from env. If empty, fall back to config’s baseMints.
  let baseMints: PublicKey[] = [];
  const envBaseMints = parseBaseMintsFromEnv();
  if (envBaseMints.length) {
    baseMints = envBaseMints;
  } else if (Array.isArray(cfg?.baseMints) && cfg.baseMints.length) {
    baseMints = cfg.baseMints.map((m) => new PublicKey(m));
  } else {
    console.log('> No BASE_MINTS provided and none in config. Nothing to scan.');
    return;
  }

  // Optional: leftoverReceiver override; else rely on what’s stored in the on-chain config
  const leftoverReceiverStr = process.env.LEFTOVER_RECEIVER || cfg?.leftoverReceiver || signer.publicKey.toBase58();
  const leftoverReceiver = new PublicKey(leftoverReceiverStr);

  console.log(`> Claiming leftovers with wallet ${signer.publicKey.toBase58()}`);
  console.log(`> RPC: ${rpcUrl}`);
  console.log(`> Config key: ${DBC_CONFIG_KEY}`);
  console.log(`> leftoverReceiver: ${leftoverReceiver.toBase58()}`);
  console.log(`> Base mints to scan: ${baseMints.length}`);

  const results: LeftoverReport[] = [];

  for (const baseMint of baseMints) {
    console.log(`\n— Checking baseMint ${baseMint.toBase58()} ...`);
    const report: LeftoverReport = { baseMint: baseMint.toBase58(), status: 'skipped' };

    try {
      // Fetch pool by base mint; SDK naming differs across versions, so try a couple options.
      // 1) Preferred helper:
      let pool: any | undefined;
      if (typeof (client as any).getPoolByBaseMint === 'function') {
        pool = await (client as any).getPoolByBaseMint(baseMint);
      } else if (typeof (client as any).fetchPoolByBaseMint === 'function') {
        pool = await (client as any).fetchPoolByBaseMint(baseMint);
      } else {
        // Fallback: try public mapping by address if your repo exposes one
        // (Your repo previously mapped pools in claim_all.ts; we gracefully exit here if not available.)
        throw new Error('SDK does not expose getPoolByBaseMint/fetchPoolByBaseMint on this version.');
      }

      if (!pool) throw new Error('DBC Pool not found for this base mint.');

      report.pool = pool?.pubkey?.toBase58?.() ?? pool?.address?.toBase58?.() ?? '(unknown)';
      report.poolConfig = pool?.config?.toBase58?.() ?? '(unknown)';

      // Detect completion & leftover availability:
      // Different SDK versions attach these under different fields; check a few:
      const status =
        pool?.state?.status ||
        pool?.status ||
        '';
      const isCompleted =
        status === 'completed' ||
        status === 'finished' ||
        pool?.state?.isFinished === true ||
        pool?.isFinished === true;

      // Quote vault (SOL) balance
      const quoteVaultPk: PublicKey | undefined =
        pool?.vaultQuote ||
        pool?.quoteVault ||
        pool?.state?.vaultQuote;

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

      // Build leftover claim instruction
      // Prefer a high-level helper if it exists; else fall back to a lower-level builder.
      let ix;
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
        // Some SDKs expose a direct RPC call builder
        ix = await (client as any).claimLeftoverBase({
          poolPublicKey: new PublicKey(report.pool!),
          leftoverReceiver,
          payer: signer.publicKey,
        });
      } else {
        throw new Error('SDK version missing a leftover-claim builder. Update @meteora-ag/dynamic-bonding-curve-sdk.');
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

  // CSV-ish summary for Actions artifact/logs
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
