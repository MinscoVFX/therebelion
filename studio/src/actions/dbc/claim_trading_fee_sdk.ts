// studio/src/scripts/dbc/claim_trading_fee_sdk.ts
import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
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
    .map((s: string) => s.trim())
    .filter(Boolean);
  if (!list.length)
    throw new Error(
      'BASE_MINTS is empty. Set a comma-separated list of base mints in Actions secrets.'
    );
  return list.map((m: string) => {
    try {
      return new PublicKey(m);
    } catch {
      throw new Error(`Invalid base58 mint address in BASE_MINTS: ${m}`);
    }
  });
}

function resolveSdkClaim(client: unknown) {
  const candidates = [
    'partner.claimTradingFee',
    'partner.claimPartnerTradingFee',
    'partner.claimFee',
    'claimPartnerTradingFee',
    'claimTradingFee',
  ];
  for (const path of candidates) {
    const fn = path
      .split('.')
      .reduce<unknown>(
        (o, k) =>
          o && (o as Record<string, unknown>)[k] !== undefined
            ? (o as Record<string, unknown>)[k]
            : undefined,
        client
      );
    if (typeof fn === 'function') {
      return async (args: {
        baseMint: PublicKey;
        payer: PublicKey;
        feeClaimer: PublicKey;
        computeUnitPriceMicroLamports?: number;
      }): Promise<{ tx?: Transaction; sig?: string }> => {
        const clientWithPartner = client as { partner?: unknown };
        const res = await fn.call(clientWithPartner.partner ?? client, {
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

async function getPartnerFeesSafe(
  client: DynamicBondingCurveClient,
  baseMint: PublicKey,
  partner: PublicKey
): Promise<number | null> {
  try {
    if (typeof client.partner?.getPartnerFees === 'function') {
      const fees = await client.partner.getPartnerFees({ baseMint, partner });
      const lamports = fees?.toNumber ? fees.toNumber() : Number(fees || 0);
      return lamports / 1e9;
    }
  } catch (err) {
    console.warn(`⚠️  Could not fetch fees for ${baseMint.toBase58()}: ${err}`);
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

  // Step 1 — Get fee amounts
  const mintFeeList: { baseMint: PublicKey; solAmount: number }[] = [];
  for (const baseMint of mints) {
    const amount = await getPartnerFeesSafe(client, baseMint, me);
    mintFeeList.push({
      baseMint,
      solAmount: amount === null ? Number.MAX_SAFE_INTEGER : amount,
    });
  }

  // Step 2 — Sort by highest first
  mintFeeList.sort((a, b) => b.solAmount - a.solAmount);

  // Step 3 — Claim
  for (const { baseMint, solAmount } of mintFeeList) {
    const mintStr = baseMint.toBase58();

    if (solAmount !== Number.MAX_SAFE_INTEGER) {
      if (solAmount <= 0) {
        console.log(`ℹ️  No fees for ${mintStr}, skipping`);
        continue;
      }
      if (solAmount < MIN_SOL_THRESHOLD) {
        console.log(`⚠️  ${mintStr} has ${solAmount} SOL (< ${MIN_SOL_THRESHOLD}), skipping`);
        continue;
      }
    }

    console.log(
      `— Claiming for baseMint ${mintStr} (${solAmount === Number.MAX_SAFE_INTEGER ? 'unknown fees' : `${solAmount} SOL`})`
    );

    try {
      // Try lib first
      try {
        const runCfg: DbcConfig = { ...cfg, baseMint: mintStr };
        await claimFromLib(runCfg, conn, wallet);
        console.log('✔ Claimed via lib/dbc');
        ok++;
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
        console.log(`✔ Claimed via SDK (internal submit). Tx: ${res.sig}`);
        ok++;
        continue;
      }
      if (res.tx) {
        res.tx.feePayer = me;
        res.tx.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: cfg.computeUnitPriceMicroLamports ?? 100_000,
          })
        );

        let attempt = 0;
        let sent = false;
        let sig: string | undefined;
        let lastErr: any;

        while (attempt < 3 && !sent) {
          attempt++;
          try {
            const latest = await conn.getLatestBlockhash(DEFAULT_COMMITMENT_LEVEL);
            res.tx.recentBlockhash = latest.blockhash;

            sig = await sendAndConfirmTransaction(conn, res.tx, [keypair], {
              commitment: DEFAULT_COMMITMENT_LEVEL,
              skipPreflight: false,
              maxRetries: 3,
            });
            sent = true;
          } catch (err: any) {
            lastErr = err;
            if (!/block height exceeded|blockhash not found/i.test(String(err?.message))) {
              break; // not retryable
            }
            console.warn(`Retrying ${mintStr} due to expired blockhash (attempt ${attempt})`);
          }
        }

        if (!sent) throw lastErr;
        console.log(`✔ Claimed via SDK (signed locally). Tx: ${sig}`);
        ok++;
        continue;
      }

      throw new Error('SDK did not return a transaction or signature');
    } catch (e: any) {
      console.error(`✖ Claim failed for ${mintStr}: ${e?.message || String(e)}`);
      fail++;
    }
  }

  console.log(`Summary — Success: ${ok}  Failed: ${fail}`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
