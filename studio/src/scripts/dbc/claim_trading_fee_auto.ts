// studio/src/scripts/dbc/claim_trading_fee_auto.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Idl, Wallet as AnchorWallet } from '@coral-xyz/anchor';
import { safeParseKeypairFromFile, parseConfigFromCli } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import { DbcConfig } from '../../utils/types';
import { claimTradingFee } from '../../lib/dbc';

function tryLoadSdk() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require('@meteora-ag/dynamic-bonding-curve-sdk');
    const idl: Idl | undefined =
      sdk.IDL || sdk.DBC_IDL || sdk.DbcIDL || sdk.idl || undefined;
    const pidLike =
      sdk.PROGRAM_ID ||
      sdk.DBC_PROGRAM_ID ||
      sdk.DYNAMIC_BONDING_CURVE_PROGRAM_ID ||
      sdk.programId ||
      undefined;
    const programId = pidLike ? new PublicKey(pidLike.toString()) : undefined;
    return { idl, programId };
  } catch {
    return { idl: undefined, programId: undefined };
  }
}

function requireProgramId(sdkProgramId?: PublicKey): PublicKey {
  if (sdkProgramId) return sdkProgramId;
  const fromEnv = process.env.DBC_PROGRAM_ID?.trim();
  if (!fromEnv) {
    throw new Error(
      'DBC program id not found. Set env DBC_PROGRAM_ID, or ensure the SDK exports PROGRAM_ID.'
    );
  }
  return new PublicKey(fromEnv);
}

async function loadProgram(
  connection: Connection,
  wallet: AnchorWallet
): Promise<Program> {
  const { idl: sdkIdl, programId: sdkPid } = tryLoadSdk();
  const programId = requireProgramId(sdkPid);

  const provider = new AnchorProvider(connection, wallet, {
    commitment: DEFAULT_COMMITMENT_LEVEL,
  });

  let idl: Idl | null = (sdkIdl as Idl) || null;
  if (!idl) {
    idl = (await Program.fetchIdl(programId, provider)) as Idl | null;
    if (!idl) {
      throw new Error(
        'Unable to fetch DBC IDL from chain. Provide IDL via SDK or set DBC_PROGRAM_ID to a program that publishes its IDL.'
      );
    }
  }

  return new Program(idl as Idl, programId, provider);
}

function looksLikePoolAccount(a: any) {
  // Anchor decodes to fields on `account`
  if (!a) return false;
  const hasBaseMint = a.baseMint instanceof PublicKey || typeof a.baseMint?.toBase58 === 'function';
  const hasCreator = a.creator instanceof PublicKey || typeof a.creator?.toBase58 === 'function';
  const hasPartner = a.partner instanceof PublicKey || typeof a.partner?.toBase58 === 'function';
  // feeClaimer may be optional on some pools; treat as optional but preferred
  const hasFeeClaimer = a.feeClaimer instanceof PublicKey || typeof a.feeClaimer?.toBase58 === 'function';
  return hasBaseMint && hasCreator && hasPartner && (hasFeeClaimer || true);
}

async function findPoolAccountNamespace(program: Program): Promise<string> {
  const namespaces = Object.keys((program as any).account || {});
  for (const ns of namespaces) {
    try {
      // @ts-ignore dynamic
      const sample = await (program as any).account[ns].all();
      if (!Array.isArray(sample) || sample.length === 0) continue;
      if (looksLikePoolAccount(sample[0].account)) return ns;
    } catch {
      // ignore and continue
    }
  }
  throw new Error(
    'Could not locate the DBC pool account in IDL (no account type with baseMint/creator/partner found).'
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
  const wallet = new AnchorWallet(keypair);

  const program = await loadProgram(connection, wallet);
  const poolNs = await findPoolAccountNamespace(program);

  // @ts-ignore dynamic account ns
  const allPools: Array<{ publicKey: PublicKey; account: any }> = await (program as any).account[
    poolNs
  ].all();

  const me = keypair.publicKey;
  const claimables = allPools.filter(({ account }) => {
    const feeClaimer = account.feeClaimer as PublicKey | undefined;
    const partner = account.partner as PublicKey | undefined;
    const creator = account.creator as PublicKey | undefined;
    return (
      feeClaimer?.equals?.(me) ||
      partner?.equals?.(me) ||
      creator?.equals?.(me)
    );
  });

  console.log(`\n> Found ${claimables.length} pool(s) claimable by ${me.toBase58()}`);
  if (!claimables.length) {
    console.log('Nothing to claim.');
    return;
  }

  let ok = 0;
  let fail = 0;

  for (const { account } of claimables) {
    const baseMint: PublicKey = account.baseMint as PublicKey;
    const mintStr = baseMint.toBase58();
    console.log(`\n=== Claiming trading fee for baseMint ${mintStr} ===`);
    try {
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
