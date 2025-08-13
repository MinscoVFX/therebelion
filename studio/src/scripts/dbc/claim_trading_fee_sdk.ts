// studio/src/scripts/dbc/claim_trading_fee_sdk.ts
import {
  Connection,
  PublicKey,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import { Wallet as AnchorWallet } from '@coral-xyz/anchor';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { parseConfigFromCli, safeParseKeypairFromFile } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import type { DbcConfig } from '../../utils/types';
import { claimTradingFee as claimFromLib } from '../../lib/dbc';

// Try a set of SDK method names across versions; always return a TX builder.
function resolveSdkTxBuilder(client: any) {
  const tries = [
    'partner.claimTradingFee',
    'partner.claimPartnerTradingFee',
    'partner.claimFee',
    'claimPartnerTradingFee',
    'claimTradingFee',
  ];

  for (const path of tries) {
    const fn = path.split('.').reduce<any>(
      (obj, key) => (obj && obj[key] !== undefined ? obj[key] : undefined),
      client,
    );
    if (typeof fn === 'function') {
      return async (args: {
        baseMint: PublicKey;
        payer: PublicKey;
        feeClaimer: PublicKey;
        computeUnitPriceMicroLamports?: number;
      }): Promise<Transaction> => {
        // Most SDK variants return a Transaction. If a signature string is returned, we throw to fallback.
        const maybe = await fn.call(client.partner ?? client, {
          baseMint: args.baseMint,
          payer: args.payer,
          feeClaimer: args.feeClaimer,
          computeUnitPriceMicroLamports: args.computeUnitPriceMicroLamports,
        });

        if (maybe && typeof (maybe as Transaction).serialize === 'function') {
          return maybe as Transaction;
        }
        if (typeof maybe === 'string') {
          // Some very old versions might submit internally and return a sig.
          // We don't rely on that; let fallback handle it uniformly.
          throw new Error('SDK returned signature string; using fallback sender.');
        }
        throw new Error('Unsupported SDK response; using fallback sender.');
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

  const baseMints = (process.env.BASE_MINTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!baseMints.length) {
    throw new Error(
      'BASE_MINTS is empty. Set a comma-separated list of base mint addresses in Actions secrets.'
    );
  }

  console.log(`> Claiming partner trading fees with wallet ${me.toBase58()}`);
  console.log(`> RPC: ${rpc}`);
  console.log(`> Pools: ${baseMints.length}`);

  // Validate base58 mints early (also catches “Only base58” issues)
  for (const m of baseMints) {
    try {
      new PublicKey(m);
    } catch {
      throw new Error(`Invalid base58 mint address in BASE_MINTS: ${m}`);
    }
  }

  const client = new DynamicBondingCurveClient(conn, DEFAULT_COMMITMENT_LEVEL) as any;
  const buildTx = resolveSdkTxBuilder(client);

  let ok = 0;
  let fail = 0;

  for (const mintStr of baseMints) {
    const baseMint = new PublicKey(mintStr);
    console.log(`— Claiming for baseMint ${baseMint.toBase58()} ...`);
    try {
      if (buildTx) {
        // Use SDK to build the transaction; then we sign+send it.
        const tx = await buildTx({
          baseMint,
          payer: me,        // PublicKey (not Keypair)
          feeClaimer: me,   // PublicKey (not Keypair)
          computeUnitPriceMicroLamports: cfg.computeUnitPriceMicroLamports ?? 100_000,
        });
        tx.feePayer = me;
        const { blockhash } = await conn.getLatestBlockhash(DEFAULT_COMMITMENT_LEVEL);
        tx.recentBlockhash = blockhash;

        const sig = await sendAndConfirmTransaction(conn, tx, [keypair], {
          commitment: DEFAULT_COMMITMENT_LEVEL,
          skipPreflight: true,
          maxRetries: 5,
        });
        console.log(`✔ Claimed via SDK. Tx: ${sig}`);
      } else {
        // Fallback to your in-repo implementation
        const runCfg: DbcConfig = { ...cfg, baseMint: baseMint.toBase58() };
        await claimFromLib(runCfg, conn, wallet);
        console.log(`✔ Claimed via fallback lib/dbc`);
      }
      ok++;
    } catch (e: any) {
      console.error(`✖ Claim failed: ${e?.message || String(e)}`);
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
