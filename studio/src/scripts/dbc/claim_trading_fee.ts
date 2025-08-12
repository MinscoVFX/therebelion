import { Connection, PublicKey } from '@solana/web3.js';
import { safeParseKeypairFromFile, parseConfigFromCli } from '../../helpers';
import { Wallet } from '@coral-xyz/anchor';
import { DbcConfig } from '../../utils/types';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import { claimTradingFee } from '../../lib/dbc';

/** Minimal CLI flag parser: supports --name value and --name=value */
function getFlag(name: string): string | undefined {
  const long = `--${name}`;
  const i = process.argv.findIndex(a => a === long || a.startsWith(`${long}=`));
  if (i === -1) return undefined;
  const a = process.argv[i];
  if (a.includes('=')) return a.split('=').slice(1).join('=');
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) return next;
  return '';
}

async function main() {
  const config = (await parseConfigFromCli()) as DbcConfig;

  // Resolve baseMint from: CLI flag > ENV > config file
  const flagBaseMint = getFlag('base-mint')?.trim();
  const envBaseMint  = process.env.BASE_MINT?.trim();
  const chosenBaseMint = (flagBaseMint || envBaseMint || config.baseMint)?.trim();

  if (!chosenBaseMint) {
    throw new Error(
      'Missing baseMint. Provide via --base-mint, BASE_MINT env, or in the config file.'
    );
  }

  // Validate/normalize mints
  let baseMint: PublicKey;
  let quoteMint: PublicKey;
  try {
    baseMint = new PublicKey(chosenBaseMint);
  } catch {
    throw new Error(`Invalid baseMint (not valid base58): ${chosenBaseMint}`);
  }
  if (!config.quoteMint) throw new Error('Missing quoteMint in configuration');
  try {
    quoteMint = new PublicKey(config.quoteMint);
  } catch {
    throw new Error(`Invalid quoteMint (not valid base58): ${config.quoteMint}`);
  }

  // Mutate config so downstream uses the resolved value
  (config as any).baseMint = baseMint.toBase58();

  console.log(`> Using keypair file path ${config.keypairFilePath}`);
  const keypair = await safeParseKeypairFromFile(config.keypairFilePath);

  console.log('\n> Initializing with general configuration...');
  console.log(`- Using RPC URL ${config.rpcUrl}`);
  console.log(`- Dry run = ${config.dryRun}`);
  console.log(`- Using wallet ${keypair.publicKey} to claim trading fee`);
  console.log(`- Using quote token mint ${quoteMint.toBase58()}`);
  console.log(
    `- Using base token mint ${baseMint.toBase58()} (source: ${
      flagBaseMint ? 'CLI --base-mint' : envBaseMint ? 'ENV BASE_MINT' : 'config'
    })`
  );

  const connection = new Connection(config.rpcUrl, DEFAULT_COMMITMENT_LEVEL);
  const wallet = new Wallet(keypair);

  /// --------------------------------------------------------------------------
  await claimTradingFee(config, connection, wallet);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
