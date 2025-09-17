// studio/src/scripts/dbc/claim_trading_fee_auto.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Idl, Wallet as AnchorWallet } from '@coral-xyz/anchor';
import { safeParseKeypairFromFile, parseConfigFromCli } from '../../helpers';
import { DEFAULT_COMMITMENT_LEVEL } from '../../utils/constants';
import { DbcConfig } from '../../utils/types';
import { claimTradingFee } from '../../lib/dbc';

async function tryLoadSdk() {
  try {
    const sdk = await import('@meteora-ag/dynamic-bonding-curve-sdk') as Record<string, unknown>;
    const idl: Idl | undefined =
      (sdk.IDL as Idl) ||
      (sdk.DBC_IDL as Idl) ||
      (sdk.DbcIDL as Idl) ||
      (sdk.idl as Idl) ||
      undefined;
    const pidLike =
      (sdk.PROGRAM_ID as string | PublicKey) ||
      (sdk.DBC_PROGRAM_ID as string | PublicKey) ||
      (sdk.DYNAMIC_BONDING_CURVE_PROGRAM_ID as string | PublicKey) ||
      (sdk.programId as string | PublicKey) ||
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

function idlLooksUsable(idl: Idl | null | undefined): idl is Idl {
  return !!idl && Array.isArray((idl as { accounts?: unknown[] }).accounts) && ((idl as { accounts?: unknown[] }).accounts?.length ?? 0) > 0;
}

async function loadProgram(connection: Connection, wallet: AnchorWallet): Promise<Program> {
  const { idl: sdkIdl, programId: sdkPid } = await tryLoadSdk();
  const programId = requireProgramId(sdkPid);

  const provider = new AnchorProvider(connection, wallet, { commitment: DEFAULT_COMMITMENT_LEVEL });

  let idl: Idl | null = (sdkIdl as Idl) || null;

  if (!idlLooksUsable(idl)) {
    const P = Program as unknown as { 
      fetchIdl: (arg1: AnchorProvider | PublicKey, arg2?: PublicKey | AnchorProvider) => Promise<Idl | null> 
    };
    try {
      idl = (await P.fetchIdl(provider, programId)) as Idl | null;
    } catch {
      idl = (await P.fetchIdl(programId, provider)) as Idl | null;
    }
  }

  if (!idlLooksUsable(idl)) {
    const hint =
      'Auto-discovery requires a valid DBC IDL (with accounts). Provide via SDK or set DBC_PROGRAM_ID to a program that publishes its IDL.';
    throw new Error(`DBC IDL unavailable or incomplete. ${hint}`);
  }

  const ProgramCtor: any = Program as any;
  return new ProgramCtor(idl as Idl, programId, provider);
}

function looksLikePoolAccount(a: unknown) {
  const x = a as Record<string, unknown> | null | undefined;
  if (!x) return false;
  const baseMint = x['baseMint'] as unknown;
  const creator = x['creator'] as unknown;
  const partner = x['partner'] as unknown;
  type MaybeToBase58 = { toBase58?: () => string };
  const hasBaseMint =
    baseMint instanceof PublicKey || typeof (baseMint as MaybeToBase58)?.toBase58 === 'function';
  const hasCreator =
    creator instanceof PublicKey || typeof (creator as MaybeToBase58)?.toBase58 === 'function';
  const hasPartner =
    partner instanceof PublicKey || typeof (partner as MaybeToBase58)?.toBase58 === 'function';
  return hasBaseMint && hasCreator && hasPartner;
}

async function findPoolAccountNamespace(program: Program): Promise<string> {
  const accountsNs = ((program as unknown as { account?: Record<string, unknown> })?.account || {}) as Record<string, { all?: () => Promise<Array<{ account: unknown }>> }>;
  const namespaces = Object.keys(accountsNs);
  for (const ns of namespaces) {
    try {
      if (!accountsNs[ns]?.all) continue;
      const sample = await accountsNs[ns].all?.();
      if (!Array.isArray(sample) || sample.length === 0) continue;
      if (looksLikePoolAccount(sample[0]?.account)) return ns;
    } catch {
      // continue scanning
    }
  }
  throw new Error(
    'Could not locate the DBC pool account in IDL (no account type with baseMint/creator/partner found).'
  );
}

function parseBaseMintsFromEnv(): string[] {
  const raw = (process.env.BASE_MINTS || '').trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    )
  );
}

async function claimByEnvList(
  config: DbcConfig,
  connection: Connection,
  wallet: AnchorWallet
): Promise<number> {
  const baseMints = parseBaseMintsFromEnv();
  if (baseMints.length === 0) {
    console.error(
      'Fallback mode: BASE_MINTS is empty. Set the BASE_MINTS env (comma-separated) or provide a valid DBC IDL.'
    );
    return 0;
  }
  console.log(`> Fallback: claiming ${baseMints.length} mint(s) from BASE_MINTS`);

  let ok = 0;
  for (const mint of baseMints) {
    const runCfg: DbcConfig = { ...config, baseMint: mint };
    console.log(`\n=== Claiming trading fee for baseMint ${mint} ===`);
    try {
      await claimTradingFee(runCfg, connection, wallet);
      console.log(`✔ Success for ${mint}`);
      ok++;
    } catch (e: any) {
      console.error(`✖ Failed for ${mint}: ${e?.message || String(e)}`);
    }
  }
  return ok;
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

  try {
    const program = await loadProgram(connection, wallet);
    const poolNs = await findPoolAccountNamespace(program);

    const accountsNs = ((program as unknown as { account?: Record<string, unknown> })?.account || {}) as Record<string, { all?: () => Promise<Array<{ publicKey: PublicKey; account: unknown }>> }>;
    const allPools: Array<{ publicKey: PublicKey; account: unknown }> = await accountsNs[poolNs].all?.() || [];

    const me = keypair.publicKey;
    const claimables = allPools.filter(({ account }) => {
      const poolAccount = account as { feeClaimer?: PublicKey; partner?: PublicKey; creator?: PublicKey };
      const feeClaimer = poolAccount.feeClaimer;
      const partner = poolAccount.partner;
      const creator = poolAccount.creator;
      return feeClaimer?.equals?.(me) || partner?.equals?.(me) || creator?.equals?.(me);
    });

    console.log(`\n> Found ${claimables.length} pool(s) claimable by ${me.toBase58()}`);
    if (!claimables.length) {
      console.log('Nothing to claim.');
      return;
    }

    let ok = 0;
    let fail = 0;

    for (const { account } of claimables) {
      const poolAccount = account as { baseMint: PublicKey };
      const baseMint: PublicKey = poolAccount.baseMint;
      const mintStr = baseMint.toBase58();
      console.log(`\n=== Claiming trading fee for baseMint ${mintStr} ===`);
      try {
        const runCfg: DbcConfig = { ...config, baseMint: mintStr };
        await claimTradingFee(runCfg, connection, wallet);
        console.log(`✔ Success for ${mintStr}`);
        ok++;
      } catch (e: unknown) {
        console.error(`✖ Failed for ${mintStr}: ${(e as Error)?.message || String(e)}`);
        fail++;
      }
    }

    console.log(`\n> Summary: Success ${ok}, Failed ${fail}`);
    if (fail) process.exit(1);
  } catch (autoErr: any) {
    console.warn(`\n[Auto-discovery disabled] ${autoErr?.message || String(autoErr)}`);
    const ok = await claimByEnvList(config, connection, wallet);
    if (ok === 0) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
