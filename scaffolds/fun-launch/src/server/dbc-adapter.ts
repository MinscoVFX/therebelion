import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';

export type DbcPoolKeys = {
  pool: PublicKey;
  feeVault: PublicKey;
};

async function importStudioDbcRuntime(): Promise<any | null> {
  // Build path dynamically so Webpack doesn't try to bundle TS sources.
  const path = ['../../../../studio', 'dist', 'lib', 'dbc', 'index.js'].join('/');
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const mod = await import(/* webpackIgnore: true */ path);
    return mod ?? null;
  } catch {
    return null;
  }
}

export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey;
}): Promise<TransactionInstruction> {
  const DbcLib = await importStudioDbcRuntime();
  if (!DbcLib || !('buildClaimTradingFeeIx' in DbcLib)) {
    throw new Error(
      '[dbc-adapter] Could not load Studio DBC runtime (studio/dist/lib/dbc/index.js). ' +
      'Ensure the Studio package builds to dist before building fun-launch.'
    );
  }

  const fn = (DbcLib as any).buildClaimTradingFeeIx as (p: {
    connection: Connection;
    pool: PublicKey;
    feeVault: PublicKey;
    feeClaimer: PublicKey;
  }) => Promise<TransactionInstruction>;

  return await fn({
    connection: args.connection,
    pool: args.poolKeys.pool,
    feeVault: args.poolKeys.feeVault,
    feeClaimer: args.feeClaimer,
  });
}
