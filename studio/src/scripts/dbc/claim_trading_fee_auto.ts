// studio/src/scripts/dbc/claim_trading_fee_auto.ts
import { AnchorProvider, Program, Idl, Wallet as AnchorWallet } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { safeParseKeypairFromFile, parseConfigFromCli } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import { DbcConfig } from '../../utils/types';
import { claimTradingFee } from '../../lib/dbc';

/**
 * We try SDK-first to load the DBC program. If your SDK exports different names,
 * adjust the imports below (see comments).
 */
let DBC_IDL: Idl | undefined;
let DBC_PROGRAM_ID: PublicKey | undefined;
try {
  // Common SDK exports (adjust if your SDK uses other names)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
  DBC_IDL = sdk.IDL || sdk.DBC_IDL || sdk.DbcIDL || undefined;
  const pid = sdk.PROGRAM_ID || sdk.DBC_PROGRAM_ID || sdk.DYNAMIC_BONDING_CURVE_PROGRAM_ID;
  if (pid) DBC_PROGRAM_ID = new PublicKey(pid.toString());
} catch (_) {}

function resolveProgramId(rpcUrl: string): PublicKey {
  if (DBC_PROGRAM_ID) return DBC_PROGRAM_ID;
  const envPid = process.env.DBC_PROGRAM_ID?.trim();
  if (!envPid) {
    throw new Error(
      'DBC program id not found. Set env DBC_PROGRAM_ID or ensure the SDK exports PROGRAM_ID.'
    );
  }
  return new PublicKey(envPid);
}

async function loadDbcProgram(
  connection: Connection,
  wallet: AnchorWallet
): Promise<Program> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: DEFAULT_COMMITMENT_LEVEL,
  });

  if (!DBC_IDL) {
    // Try to fetch IDL from chain if SDK didn't provide it
    const pid = resolveProgramId(connection.rpcEndpoint);
    const fetched = await Program.fetchIdl(pid, provider);
    if (!fetched) {
      throw new Error(
        'Unable to fetch DBC IDL. Provide IDL from SDK (adjust import) or set DBC_PROGRAM_ID and allow IDL fetch.'
      );
    }
    DBC_IDL = fetched as Idl;
  }

  const programId = resolveProgramId(connection.rpcEndpoint);
  return new Program(DBC_IDL as Idl, programId, provider);
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
  const wallet = new AnchorWallet(keypair);

  // Load DBC Anchor program
  const program = await loadDbcProgram(connection, wallet);

  // Fetch ALL DBC pools (Anchor auto-deserializes using IDL)
  // Account name in IDL is usually 'dbcPool'. If your IDL uses a different name,
  // change 'dbcPool' below accordingly.
  // @ts-ignore - indexer access on Program.account
  const pools = await program.account.dbcPool.all();

  const me = keypair.publicKey;
  const claimables = pools.filter((p: any) => {
    const a = p.account;
    // adjust field names if IDL uses different ones:
    // creator, partner, feeClaimer are common; also try leftoverReceiver if needed
    return (
      a?.feeClaimer?.equals?.(me) ||
      a?.partner?.equals?.(me) ||
      a?.creator?.equals?.(me)
    );
  });

  console.log(`\n> Found ${claimables.length} pool(s) where you can claim fees.`);
  if (!claimables.length) {
    console.log('Nothing to claim.');
    return;
  }

  let ok = 0;
  let fail = 0;

  for (const p of claimables) {
    // Adjust field name if your IDL differs; usually 'baseMint'
    const baseMint: PublicKey = p.account.baseMint as PublicKey;
    const mintStr = baseMint.toBase58();
    console.log(`\n=== Claiming trading fee for baseMint ${mintStr} ===`);
    try {
      // clone config and set baseMint dynamically
      const runCfg: DbcConfig = { ...config, baseMint: mintStr };
      await claimTradingFee(runCfg, connection, wallet);
      console.log(`✔ Success for ${mintStr}`);
      ok++;
    } catch (e: any) {
      console.error(`✖ Failed for ${mintStr}: ${e?.message || String(e)}`);
      fail++;
    }
  }

  console.log(`\n> Summary: Success ${ok}, Failed ${fail}`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
