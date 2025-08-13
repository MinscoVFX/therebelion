// studio/src/scripts/dbc/claim_trading_fee_sdk.ts
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Wallet as AnchorWallet } from '@coral-xyz/anchor';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { parseConfigFromCli, safeParseKeypairFromFile } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import { DbcConfig } from '../../utils/types';
import { claimTradingFee as claimTradingFeeFromLib } from '../../lib/dbc';

type AnyClient = Record<string, any>;

function resolveClaimFn(client: AnyClient) {
  // Try a few likely method names across SDK versions
  const candidates = [
    'partner.claimTradingFee',
    'partner.claimPartnerTradingFee',
    'partner.claimFee',
    'claimPartnerTradingFee',
    'claimTradingFee',
  ];

  for (const path of candidates) {
    const fn = path.split('.').reduce<unknown>(
      (obj, key) => (obj && (obj as AnyClient)[key] !== undefined ? (obj as AnyClient)[key] : undefined),
      client,
    );
    if (typeof fn === 'function') {
      // Normalize to a (baseMint, payer) call signature
      return async (baseMint: PublicKey, payer: Keypair) => {
        // Most SDK methods accept an object. We call with both shapes safely.
        const maybeSig =
          await (fn as Function).call(client.partner ?? client, { baseMint, payer }) ??
          (fn as Function).call(client.partner ?? client, baseMint, payer);
        return maybeSig as unknown;
      };
    }
  }
  return undefined;
}

async function main() {
  const config = (await parseConfigFromCli()) as DbcConfig;

  const keypair = await safeParseKeypairFromFile(config.keypairFilePath);
  const me = keypair.publicKey;

  const rpc = process.env.RPC_URL?.trim() || config.rpcUrl;
  const connection = new Connection(rpc, DEFAULT_COMMITMENT_LEVEL);
  const wallet = new AnchorWallet(keypair);

  const list =
    (process.env.BASE_MINTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  if (!list.length) {
    throw new Error('BASE_MINTS is empty. Set a comma-separated list of base mint addresses in Actions secrets.');
  }

  console.log(`> Claiming partner trading fees with wallet ${me.toBase58()}`);
  console.log(`> RPC: ${rpc}`);
  console.log(`> Pools: ${list.length}`);

  const client = new DynamicBondingCurveClient(connection, DEFAULT_COMMITMENT_LEVEL) as AnyClient;
  const claimWithSdk = resolveClaimFn(client);

  let ok = 0;
  let fail = 0;

  for (const mint of list) {
    const baseMint = new PublicKey(mint);
    console.log(`— Claiming for baseMint ${baseMint.toBase58()} ...`);
    try {
      if (claimWithSdk) {
        await claimWithSdk(baseMint, keypair);
      } else {
        // Fallback to your existing library helper (works per-baseMint)
        const runCfg: DbcConfig = { ...config, baseMint: baseMint.toBase58() };
        await claimTradingFeeFromLib(runCfg, connection, wallet);
      }
      console.log('✔ Claim submitted');
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
