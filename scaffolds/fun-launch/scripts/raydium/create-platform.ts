// scaffolds/fun-launch/scripts/raydium/create-platform.ts
import 'dotenv/config';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v || '';
}

function loadAuthority(): Keypair {
  const raw = env('RAYDIUM_PLATFORM_AUTHORITY_SECRET');
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  // base58 fallback
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

async function loadSdk(): Promise<any> {
  // dynamic import to avoid build-time dependency failures
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dyn = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  return dyn('@raydium-io/raydium-sdk-v2');
}

async function main() {
  const RPC_URL = env('RPC_URL');
  const conn = new Connection(RPC_URL, 'confirmed');
  const authority = loadAuthority();
  console.log('Authority pubkey:', authority.publicKey.toBase58());

  const sdk = await loadSdk();

  // Choose program id per cluster (docs export both)
  const programId = new PublicKey(
    RPC_URL.includes('devnet')
      ? sdk.DEV_LAUNCHPAD_PROGRAM
      : sdk.LAUNCHPAD_PROGRAM
  );

  // Raydium expects some fee/split params as "bps × 100"
  const feeRateX100 = Number(env('RAYDIUM_SHARE_FEE_BPS', false) || '20') * 100;
  const creatorFeeRateX100 = 0; // optional creator extra on-curve, set to 0 by default

  const platformScaleX100 = Number(env('RAYDIUM_MIGRATE_SPLIT_PLATFORM_BPS', false) || '0') * 100;
  const creatorScaleX100  = Number(env('RAYDIUM_MIGRATE_SPLIT_CREATOR_BPS', false) || '10000') * 100;
  const burnScaleX100     = Number(env('RAYDIUM_MIGRATE_SPLIT_BURN_BPS', false) || '0') * 100;

  // Optional branding
  const name = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Your LaunchPad';
  const web  = process.env.PUBLIC_BUCKET_URL ?? '';
  const img  = process.env.R2_PUBLIC_BASE ? `${process.env.R2_PUBLIC_BASE}/logo.png` : '';

  // Pick the create function exposed by this SDK version
  const createFn =
    sdk.createPlatformConfig ??
    sdk.createPlatormConfig ?? // some versions spell it this way
    sdk.LaunchLab?.createPlatformConfig ??
    sdk.PlatformConfig?.create;

  if (typeof createFn !== 'function') {
    throw new Error('Raydium SDK: createPlatformConfig function not found in this version');
  }

  // Devnet cpmm fee tier (optional; omit for AMM or if unknown on mainnet)
  const cpConfigIdDevnet = new PublicKey('EsTevfacYXpuho5VBuzBjDZi8dtWidGnXoSYAr8krTvz');

  const args = {
    connection: conn,
    owner: authority,   // signer/admin of the platform
    programId,
    config: {
      feeRate: feeRateX100,
      creatorFeeRate: creatorFeeRateX100,
      migrateCpLockNftScale: {
        platformScale: platformScaleX100,
        creatorScale:  creatorScaleX100,
        burnScale:     burnScaleX100,
      },
      // include cpConfigId only if you plan CPMM migrations
      ...(RPC_URL.includes('devnet') ? { cpConfigId: cpConfigIdDevnet } : {}),
      name, web, img,
    },
  };

  const result = await createFn(args);

  // Try to print Platform PDA regardless of return shape
  const platformId: PublicKey | undefined =
    result?.platformID ?? result?.platformId ?? result?.id ?? result?.platform;

  if (platformId) {
    const pdaStr = new PublicKey(platformId).toBase58();
    console.log('Platform PDA:', pdaStr);
  }

  // If a tx or txs are returned, send them (some versions do)
  const txs: Transaction[] =
    result?.tx ? [result.tx] :
    (Array.isArray(result?.txs) ? result.txs : []);

  for (const tx of txs) {
    tx.feePayer = authority.publicKey;
    const sig = await sendAndConfirmTransaction(conn, tx, [authority]);
    console.log('Tx signature:', sig);
  }

  // If only txids were returned, print them
  if (result?.txid)  console.log('Tx id:', result.txid);
  if (result?.txids) console.log('Tx ids:', result.txids);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
