import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { parseConfigFromCli, safeParseKeypairFromFile } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import type { DbcConfig } from '../../utils/types';

async function main() {
  const cfg = (await parseConfigFromCli()) as DbcConfig;
  const keypair = await safeParseKeypairFromFile(cfg.keypairFilePath);
  const rpc = process.env.RPC_URL?.trim() || cfg.rpcUrl;
  const conn = new Connection(rpc, DEFAULT_COMMITMENT_LEVEL);

  // Initialize official SDK client
  const client: any = new (DynamicBondingCurveClient as any)(conn, DEFAULT_COMMITMENT_LEVEL);

  const baseMints = (process.env.BASE_MINTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!baseMints.length) {
    throw new Error(
      'BASE_MINTS is empty. Set a comma-separated list of base mint addresses in Actions secrets.'
    );
  }

  console.log(`> Claiming partner trading fees with wallet ${keypair.publicKey.toBase58()}`);
  console.log(`> RPC: ${rpc}`);
  console.log(`> Pools: ${baseMints.length}`);

  let ok = 0;
  let fail = 0;

  for (const mint of baseMints) {
    const baseMint = new PublicKey(mint);
    console.log(`\n— Claiming for baseMint ${baseMint.toBase58()} ...`);
    try {
      // SDK partner claim (SDK exposes partner & creator utils; TS signature varies by version)
      const res = await client.partner.claimTradingFee(
        {
          baseMint,
          feeClaimer: keypair.publicKey,
          payer: keypair.publicKey,
          computeUnitPriceMicroLamports: cfg.computeUnitPriceMicroLamports ?? 100_000,
        },
        keypair as unknown as Keypair // signer
      );

      // Some SDK versions return a tx sig, others a { txSig } object — print whatever we got
      console.log('✓ Claimed. Result:', res);
      ok++;
    } catch (e: any) {
      console.error('✖ Claim failed:', e?.message || String(e));
      fail++;
    }
  }

  console.log(`\nSummary — Success: ${ok}  Failed: ${fail}`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
