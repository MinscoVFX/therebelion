// studio/src/scripts/dbc/claim_trading_fee_sdk.ts
import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Wallet as AnchorWallet } from '@coral-xyz/anchor';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { parseConfigFromCli, safeParseKeypairFromFile } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import type { DbcConfig } from '../../utils/types';
import { claimTradingFee as claimFromLib } from '../../lib/dbc';

type FeeArgs =
  | { baseMint: PublicKey | string; partner: PublicKey | string }
  | { mint: PublicKey | string; partner: PublicKey | string };

// Do NOT use the banned `Function` type; define a precise callable shape.
type GetFeesFn = (args: FeeArgs) => Promise<unknown>;

function parseMints(): PublicKey[] {
  const list = (process.env.BASE_MINTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) {
    throw new Error(
      'BASE_MINTS is empty. Set a comma-separated list of base mints in Actions secrets.',
    );
  }
  return list.map((m) => {
    try {
      return new PublicKey(m);
    } catch {
      throw new Error(`Invalid base58 mint address in BASE_MINTS: ${m}`);
    }
  });
}

function resolveSdkClaim(client: any) {
  const candidates = [
    'partner.claimTradingFee',
    'partner.claimPartnerTradingFee',
    'partner.claimFee',
    'claimPartnerTradingFee',
    'claimTradingFee',
  ];
  for (const path of candidates) {
    const fn = path.split('.').reduce<any>(
      (o, k) => (o && o[k] !== undefined ? o[k] : undefined),
      client,
    );
    if (typeof fn === 'function') {
      return async (args: {
        baseMint: PublicKey;
        payer: PublicKey;
        feeClaimer: PublicKey;
        computeUnitPriceMicroLamports?: number;
      }): Promise<{ tx?: Transaction; sig?: string }> => {
        const res = await fn.call(client.partner ?? client, {
          baseMint: args.baseMint,
          payer: args.payer,
          feeClaimer: args.feeClaimer,
          computeUnitPriceMicroLamports: args.computeUnitPriceMicroLamports,
        });
        if (res instanceof Transaction) return { tx: res };
        if (typeof res === 'string') return { sig: res };
        if (res?.transaction instanceof Transaction) return { tx: res.transaction };
        if (typeof res?.signature === 'string') return { sig: res.signature };
        throw new Error('Unsupported SDK response');
      };
    }
  }
  return undefined;
}

/** Resolve the SDK "get partner fees" across versions and shapes */
function resolveGetPartnerFees(client: any): GetFeesFn | undefined {
  const paths = [
    'partner.getPartnerFees',
    'partner.getPartnerFee',
    'getPartnerFees',
    'getPartnerFee',
    'partner.getClaimablePartnerFees',
    'getClaimablePartnerFees',
  ];
  for (const path of paths) {
    const fn = path.split('.').reduce<any>(
      (o, k) => (o && o[k] !== undefined ? o[k] : undefined),
      client,
    );
    if (typeof fn === 'function') {
      // Bind to client.partner if present for proper `this`
      return (fn.bind(client.partner ?? client) as unknown) as GetFeesFn;
    }
  }
  return undefined;
}

/** Try multiple arg/return variants, normalize to lamports:number */
async function getPartnerFeesLamports(
  rawFn: GetFeesFn,
  baseMint: PublicKey,
  partner: PublicKey,
): Promise<number | null> {
  const argVariants: FeeArgs[] = [
    { baseMint, partner },
    { mint: baseMint, partner },
    { baseMint: baseMint.toBase58(), partner },
    { baseMint, partner: partner.toBase58() },
    { mint: baseMint.toBase58(), partner: partner.toBase58() },
  ];

  for (const args of argVariants) {
    try {
      const res = await rawFn(args);
      if (res == null) continue;

      // BN-like
      if (typeof (res as any)?.toNumber === 'function') {
        return (res as any).toNumber();
      }
      // direct number
      if (typeof res === 'number' && Number.isFinite(res)) {
        return res;
      }
      // object shapes
      const keys = ['lamports', 'amount', 'partnerFeeLamports', 'partnerFeesLamports', 'value'];
      for (const k of keys) {
        const v = (res as any)[k];
        if (typeof v?.toNumber === 'function') return v.toNumber();
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      }
      // array with first element
      if (Array.isArray(res) && res.length > 0) {
        const v = res[0];
        if (typeof v?.toNumber === 'function') return v.toNumber();
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'object' && v) {
          for (const k of keys) {
            const vv = (v as any)[k];
            if (typeof vv?.toNumber === 'function') return vv.toNumber();
            if (typeof vv === 'number' && Number.isFinite(vv)) return vv;
          }
        }
      }
    } catch {
      // try next variant
    }
  }
  return null;
}

async function main() {
  const cfg = (await parseConfigFromCli()) as DbcConfig;
  const keypair = await safeParseKeypairFromFile(cfg.keypairFilePath);
  const me = keypair.publicKey;

  const rpc = process.env.RPC_URL?.trim() || cfg.rpcUrl;
  const conn = new Connection(rpc, DEFAULT_COMMITMENT_LEVEL);
  const wallet = new AnchorWallet(keypair);

  const mints = parseMints();
  const MIN_SOL_THRESHOLD = parseFloat(process.env.MIN_SOL_THRESHOLD || '0.001');

  console.log(`> Claiming partner trading fees with wallet ${me.toBase58()}`);
  console.log(`> RPC: ${rpc}`);
  console.log(`> Pools: ${mints.length}`);
  console.log(`> Minimum claim threshold: ${MIN_SOL_THRESHOLD} SOL`);

  const client = new DynamicBondingCurveClient(conn, DEFAULT_COMMITMENT_LEVEL) as any;
  const sdkClaim = resolveSdkClaim(client);

  let ok = 0;
  let fail = 0;

  const processed = new Set<string>();
  const mintFeeList: { baseMint: PublicKey; solAmount: number }[] = [];

  // Step 1 — fetch only pools with a KNOWN fee amount (robust across SDKs)
  const rawGetFees = resolveGetPartnerFees(client);
  if (!rawGetFees) {
    console.warn('⚠️  No compatible getPartnerFees method found in SDK — all pools skipped.');
  } else {
    for (const baseMint of mints) {
      try {
        const lamports = await getPartnerFeesLamports(rawGetFees, baseMint, me);
        if (lamports === null) {
          console.warn(`⚠️  Could not read fees for ${baseMint.toBase58()}, skipping.`);
          continue;
        }
        const solAmount = lamports / 1e9;
        if (solAmount > 0) {
          mintFeeList.push({ baseMint, solAmount });
        } else {
          console.log(`ℹ️  No partner fees for ${baseMint.toBase58()}, skipping.`);
        }
      } catch (err) {
        console.error(`❌ Failed to fetch fees for ${baseMint.toBase58()}: ${err}`);
      }
    }
  }

  // Step 2 — sort by amount (desc)
  mintFeeList.sort((a, b) => b.solAmount - a.solAmount);

  // Step 3 — claim
  for (const { baseMint, solAmount } of mintFeeList) {
    const mintStr = baseMint.toBase58();

    if (processed.has(mintStr)) {
      console.log(`⏩ Already processed ${mintStr}, skipping...`);
      continue;
    }

    if (solAmount < MIN_SOL_THRESHOLD) {
      console.log(
        `⚠️  Fees (${solAmount} SOL) below threshold (${MIN_SOL_THRESHOLD} SOL), skipping...`,
      );
      processed.add(mintStr);
      continue;
    }

    console.log(`— Claiming for baseMint ${mintStr} ...`);
    console.log(`   Partner fees to claim: ${solAmount} SOL`);

    try {
      // Prefer repo’s implementation (matches your lib version best)
      try {
        const runCfg: DbcConfig = { ...cfg, baseMint: mintStr };
        await claimFromLib(runCfg, conn, wallet);
        console.log('✔ Claimed via lib/dbc');
        ok++;
        processed.add(mintStr);
        continue;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/DBC Pool not found|not claimable|invalid pool|not authorized/i.test(msg)) {
          throw e;
        }
      }

      // SDK fallback
      if (!sdkClaim) throw new Error('SDK claim function not found');
      const res = await sdkClaim({
        baseMint,
        payer: me,
        feeClaimer: me,
        computeUnitPriceMicroLamports: cfg.computeUnitPriceMicroLamports ?? 100_000,
      });

      if (res.sig) {
        console.log(`✔ Claimed via SDK (submitted internally). Tx: ${res.sig}`);
        ok++;
        processed.add(mintStr);
        continue;
      }
      if (res.tx) {
        const tx = res.tx;
        tx.feePayer = me;
        const { blockhash } = await conn.getLatestBlockhash(DEFAULT_COMMITMENT_LEVEL);
        tx.recentBlockhash = blockhash;
        const sig = await sendAndConfirmTransaction(conn, tx, [keypair], {
          commitment: DEFAULT_COMMITMENT_LEVEL,
          skipPreflight: true,
          maxRetries: 5,
        });
        console.log(`✔ Claimed via SDK (signed locally). Tx: ${sig}`);
        ok++;
        processed.add(mintStr);
        continue;
      }

      throw new Error('SDK did not return a transaction or signature');
    } catch (e: any) {
      console.error(`✖ Claim failed: ${e?.message || String(e)}`);
      fail++;
      processed.add(mintStr);
    }
  }

  console.log(`Summary — Success: ${ok}  Failed: ${fail}`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
