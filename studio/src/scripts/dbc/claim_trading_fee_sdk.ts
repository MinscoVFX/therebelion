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

  const processed = new Set<string>(); // Track already processed mints
  const mintFeeList: { baseMint: PublicKey; solAmount: number }[] = [];

  // --- Step 1: Fetch all fees
  for (const baseMint of mints) {
    try {
      if (typeof client.partner?.getPartnerFees === 'function') {
        const fees = await client.partner.getPartnerFees({
          baseMint,
          partner: me,
        });
        const lamports = fees?.toNumber ? fees.toNumber() : Number(fees || 0);
        const solAmount = lamports / 1e9;
        mintFeeList.push({ baseMint, solAmount });
      } else {
        console.warn(
          `⚠️  getPartnerFees() not found in SDK, skipping fee check for ${baseMint.toBase58()}`,
        );
        mintFeeList.push({ baseMint, solAmount: Number.MAX_SAFE_INTEGER });
      }
    } catch (err) {
      console.error(`❌ Failed to fetch fees for ${baseMint.toBase58()}: ${err}`);
    }
  }

  // --- Step 2: Sort pools by SOL amount
  mintFeeList.sort((a, b) => b.solAmount - a.solAmount);

  // --- Step 3: Claim in sorted order
  for (const { baseMint, solAmount } of mintFeeList) {
    const mintStr = baseMint.toBase58();

    if (processed.has(mintStr)) {
      console.log(`⏩ Already processed ${mintStr}, skipping...`);
      continue;
    }

    if (solAmount <= 0) {
      console.log(`ℹ️  No partner fees available for ${mintStr}, skipping...`);
      processed.add(mintStr);
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
      // 1) Try repo’s implementation
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

      // 2) SDK fallback
      if (!sdkClaim) throw new Error('SDK claim function not found');
      const res = await sdkClaim({
        baseMint,
        payer: me,
        feeClaimer: me,
        computeUnitPriceMicroLamports:
          cfg.computeUnitPriceMicroLamports ?? 100_000,
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
      processed.add(mintStr); // Avoid retrying failed mints in same run
    }
  }

  console.log(`Summary — Success: ${ok}  Failed: ${fail}`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
