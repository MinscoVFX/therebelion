// studio/src/scripts/dbc/claim_trading_fee_sdk.ts
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionMessage,
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
  if (!list.length) throw new Error('BASE_MINTS is empty. Set a comma-separated list of base mints in Actions secrets.');
  return list.map((m) => {
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
    const fn = path.split('.').reduce<any>(
      (o, k) => (o && (o as Record<string, unknown>)[k] !== undefined ? (o as Record<string, unknown>)[k] : undefined),
      client,
    );
    if (typeof fn === 'function') {
      return async (args: {
        baseMint: PublicKey;
        payer: PublicKey;
        feeClaimer: PublicKey;
        computeUnitPriceMicroLamports?: number;
      }): Promise<{ tx?: Transaction; sig?: string }> => {
        const res = await fn.call((client as any).partner ?? client, {
          baseMint: args.baseMint,
          payer: args.payer,
          feeClaimer: args.feeClaimer,
          computeUnitPriceMicroLamports: args.computeUnitPriceMicroLamports,
        });
        if (res instanceof Transaction) return { tx: res };
        if (typeof res === 'string') return { sig: res };
        if ((res as any)?.transaction instanceof Transaction) return { tx: (res as any).transaction };
        if (typeof (res as any)?.signature === 'string') return { sig: (res as any).signature };
        throw new Error('Unsupported SDK response');
      };
    }
  }
  return undefined;
}

async function getPartnerFeesSafe(client: any, baseMint: PublicKey, partner: PublicKey): Promise<number | null> {
  try {
    if (typeof client.partner?.getPartnerFees === 'function') {
      const fees = await client.partner.getPartnerFees({ baseMint, partner });
      const lamports = (fees?.toNumber ? fees.toNumber() : Number(fees || 0)) | 0;
      return lamports / 1e9;
    }
  } catch (err) {
    console.warn(`⚠️  Could not fetch fees for ${baseMint.toBase58()}: ${err}`);
  }
  return null;
}

/** Conservative base-fee fallback if we cannot compute precisely. */
const BASE_FEE_FALLBACK_LAMPORTS = 5_000;

/** net = inflowSOL - (baseFee + priorityFee). Returns {netSol, details}. */
async function estimateNetSol(
  conn: Connection,
  txOrUndefined: Transaction | undefined,
  payer: PublicKey,
  inflowSol: number,
  cuLimit: number,
  cuPriceMicroLamports: number,
  lookupTables?: AddressLookupTableAccount[],
): Promise<{ netSol: number; baseFeeLamports: number; prioLamports: number }> {
  const prioLamports = Math.floor((cuLimit * cuPriceMicroLamports) / 1_000_000); // microLamports/CU * CU / 1e6
  let baseFeeLamports = BASE_FEE_FALLBACK_LAMPORTS;

  if (txOrUndefined) {
    // Add CU ixs like in the real send path, then compute fee for message.
    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPriceMicroLamports }),
    );
    for (const ix of txOrUndefined.instructions) tx.add(ix);

    const { blockhash } = await conn.getLatestBlockhash(DEFAULT_COMMITMENT_LEVEL);
    tx.feePayer = payer;
    tx.recentBlockhash = blockhash;

    try {
      const msg = TransactionMessage.decompile(tx.compileMessage(), {
        addressLookupTableAccounts: lookupTables ?? [],
      }).compileToV0Message(lookupTables ?? []);
      const fee = await conn.getFeeForMessage(msg);
      baseFeeLamports =
        typeof fee === 'number'
          ? fee
          : (fee as any)?.value ?? BASE_FEE_FALLBACK_LAMPORTS;
    } catch {
      // fall back
    }
  }

  const totalLamports = baseFeeLamports + prioLamports;
  const totalSolFees = totalLamports / LAMPORTS_PER_SOL;
  const netSol = inflowSol - totalSolFees;
  return { netSol, baseFeeLamports, prioLamports };
}

async function main() {
  const cfg = (await parseConfigFromCli()) as DbcConfig;
  const keypair = await safeParseKeypairFromFile(cfg.keypairFilePath);
  const me = keypair.publicKey;

  const rpc = process.env.RPC_URL?.trim() || cfg.rpcUrl;
  const conn = new Connection(rpc, DEFAULT_COMMITMENT_LEVEL);
  const wallet = new AnchorWallet(keypair);

  const mints = parseMints();

  // Knobs (env first, else config/defaults)
  const MIN_PROFIT_SOL = parseFloat(process.env.MIN_PROFIT_SOL || '0'); // net profit minimum
  const CU_LIMIT = parseInt(process.env.CU_LIMIT || '', 10) || 1_000_000;
  const CU_PRICE_MICROLAMPORTS =
    parseInt(process.env.CU_PRICE_MICROLAMPORTS || '', 10) ||
    (cfg.computeUnitPriceMicroLamports ?? 100_000);

  console.log(`> Claiming partner trading fees with wallet ${me.toBase58()}`);
  console.log(`> RPC: ${rpc}`);
  console.log(`> Pools: ${mints.length}`);
  console.log(`> Profit gate: net >= ${MIN_PROFIT_SOL} SOL (CU_LIMIT=${CU_LIMIT}, CU_PRICE_MICROLAMPORTS=${CU_PRICE_MICROLAMPORTS})`);

  const client = new DynamicBondingCurveClient(conn, DEFAULT_COMMITMENT_LEVEL) as any;
  const sdkClaim = resolveSdkClaim(client);

  let ok = 0;
  let skipped = 0;
  let fail = 0;

  // 1) Fetch inflow amounts (SOL)
  const mintFeeList: { baseMint: PublicKey; solAmount: number | null }[] = [];
  for (const baseMint of mints) {
    const amountSol = await getPartnerFeesSafe(client, baseMint, me);
    mintFeeList.push({ baseMint, solAmount: amountSol });
  }

  // 2) Sort by highest known first (unknowns last)
  mintFeeList.sort((a, b) => {
    const xa = a.solAmount ?? -1;
    const xb = b.solAmount ?? -1;
    return xb - xa;
  });

  // 3) Claim loop with profit gating
  for (const { baseMint, solAmount } of mintFeeList) {
    const mintStr = baseMint.toBase58();
    const hasAmount = solAmount !== null;

    if (hasAmount && (solAmount! <= 0)) {
      console.log(`ℹ️  No fees for ${mintStr}, skipping`);
      skipped++;
      continue;
    }

    try {
      // --- Build one transaction (via SDK) if possible for fee estimation ---
      let builtTx: Transaction | undefined;

      if (!sdkClaim) {
        console.warn('⚠️  SDK claim builder not found; using conservative fee estimate.');
      } else {
        try {
          const build = await sdkClaim({
            baseMint,
            payer: me,
            feeClaimer: me,
            // IMPORTANT: use same CU price we’ll actually send with
            computeUnitPriceMicroLamports: CU_PRICE_MICROLAMPORTS,
          });

          // If SDK *auto-submits* and returns a signature, we cannot estimate precise base fee.
          // We’ll fall back to conservative estimate (but still apply profit gate).
          builtTx = build.tx;
        } catch (e) {
          console.warn(`⚠️  Could not prebuild tx for ${mintStr}: ${String((e as any)?.message || e)}`);
        }
      }

      // Inflow we’ll receive (SOL). If unknown, treat as 0 to avoid false positives.
      const inflowSol = hasAmount ? (solAmount as number) : 0;

      // Compute net = inflow - (base + priority). If unknown inflow, this will likely skip.
      const { netSol, baseFeeLamports, prioLamports } = await estimateNetSol(
        conn,
        builtTx,
        me,
        inflowSol,
        CU_LIMIT,
        CU_PRICE_MICROLAMPORTS,
      );

      if (netSol < MIN_PROFIT_SOL) {
        const feeSol = (baseFeeLamports + prioLamports) / LAMPORTS_PER_SOL;
        console.log(
          `🛑  Not profitable for ${mintStr}. inflow=${inflowSol.toFixed(9)} SOL, fees≈${feeSol.toFixed(9)} SOL, net≈${netSol.toFixed(9)} SOL (min ${MIN_PROFIT_SOL}) — skipping`,
        );
        skipped++;
        continue;
      }

      console.log(
        `✅ Profitable for ${mintStr}. net≈${netSol.toFixed(9)} SOL — proceeding to claim…`,
      );

      // --- Prefer lib path; if it throws "not claimable" kinds, bubble out. ---
      let claimed = false;
      try {
        const runCfg: DbcConfig = { ...cfg, baseMint: mintStr, computeUnitPriceMicroLamports: CU_PRICE_MICROLAMPORTS };
        await claimFromLib(runCfg, conn, wallet);
        console.log('✔ Claimed via lib/dbc');
        ok++;
        claimed = true;
      } catch (e: any) {
        const msg = String(e?.message || e);
        // Pass through real errors; otherwise fall back to SDK path
        if (/DBC Pool not found|not claimable|invalid pool|not authorized/i.test(msg)) {
          throw e;
        }
        console.warn(`lib/dbc path failed (${msg}); falling back to SDK tx path…`);
      }
      if (claimed) continue;

      // --- SDK path ---
      if (!sdkClaim) throw new Error('SDK claim function not found');
      const res = await sdkClaim({
        baseMint,
        payer: me,
        feeClaimer: me,
        computeUnitPriceMicroLamports: CU_PRICE_MICROLAMPORTS,
      });

      if (res.sig) {
        console.log(`✔ Claimed via SDK (internal submit). Tx: ${res.sig}`);
        ok++;
        continue;
      }

      if (res.tx) {
        // Attach CU settings (same as estimate) before sending
        res.tx.feePayer = me;
        res.tx.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICROLAMPORTS }),
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

  console.log(`Summary — Success: ${ok}  Skipped (not profitable): ${skipped}  Failed: ${fail}`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
