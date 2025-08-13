// studio/src/scripts/dbc/claim_trading_fee_sdk.ts
import {
  Connection,
  PublicKey,
  Keypair,
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
  if (!list.length) throw new Error('BASE_MINTS is empty. Set a comma-separated list of base mints in Actions secrets.');
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

  console.log(`> Claiming partner trading fees with wallet ${me.toBase58()}`);
  console.log(`> RPC: ${rpc}`);
  console.log(`> Pools: ${mints.length}`);

  const client = new DynamicBondingCurveClient(conn, DEFAULT_COMMITMENT_LEVEL) as any;
  const sdkClaim = resolveSdkClaim(client);

  let ok = 0;
  let fail = 0;

  for (const baseMint of mints) {
    const mintStr = baseMint.toBase58();
    console.log(`— Claiming for baseMint ${mintStr} ...`);
    try {
      // 1) Prefer your repo’s implementation (most compatible with your lib version)
      try {
        const runCfg: DbcConfig = { ...cfg, baseMint: mintStr };
        await claimFromLib(runCfg, conn, wallet);
        console.log('✔ Claimed via lib/dbc');
        ok++;
        continue; // next mint
      } catch (e: any) {
        // Only fall through to SDK if this is NOT a “pool not found / not claimable” type error
        const msg = String(e?.message || e);
        const unrecoverable =
          /DBC Pool not found|not claimable|invalid pool|not authorized/i.test(msg);
        if (unrecoverable) {
          throw e;
        }
        // else: try SDK path
      }

      // 2) SDK fallback
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
        continue;
      }

      throw new Error('SDK did not return a transaction or signature');
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
