import { Connection } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { safeParseKeypairFromFile, parseConfigFromCli } from '../../helpers';
import { DbcConfig } from '../../utils/types';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import { claimTradingFee } from '../../lib/dbc';

function parseBaseMintsFromEnv(): string[] {
  const raw = (process.env.BASE_MINTS || '').trim();
  if (!raw)
    throw new Error('Missing BASE_MINTS. Provide a comma-separated list of base mint addresses.');
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

async function main() {
  const config = (await parseConfigFromCli()) as DbcConfig;

  console.log(`> Using keypair file path ${config.keypairFilePath}`);
  const keypair = await safeParseKeypairFromFile(config.keypairFilePath);

  console.log('\n> Initializing with general configuration...');
  console.log(`- Using RPC URL ${config.rpcUrl}`);
  console.log(`- Dry run = ${config.dryRun}`);
  console.log(`- Using wallet ${keypair.publicKey} to claim trading fees`);

  const connection = new Connection(config.rpcUrl, DEFAULT_COMMITMENT_LEVEL);
  const wallet = new Wallet(keypair);

  const baseMints = parseBaseMintsFromEnv();
  console.log(`\n> Found ${baseMints.length} base mint(s) to process`);

  const results: { mint: string; ok: boolean; error?: string }[] = [];

  for (const mint of baseMints) {
    const runCfg: DbcConfig = { ...config, baseMint: mint };
    console.log(`\n=== Claiming trading fee for baseMint ${mint} ===`);
    try {
      await claimTradingFee(runCfg, connection, wallet);
      results.push({ mint, ok: true });
      console.log(`✔ Success for ${mint}`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      results.push({ mint, ok: false, error: msg });
      console.error(`✖ Failed for ${mint}: ${msg}`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  console.log('\n> Summary:');
  console.log(`- Success: ${okCount}`);
  console.log(`- Failed:  ${failCount}`);
  if (failCount) {
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  * ${r.mint}: ${r.error}`);
    }
  }

  // Exit nonzero if any failed (so CI flags it)
  if (failCount) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
