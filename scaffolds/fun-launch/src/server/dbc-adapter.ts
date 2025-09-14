// scaffolds/fun-launch/src/server/dbc-adapter.ts
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import path from 'path';

export type DbcPoolKeys = {
  pool: PublicKey;
  feeVault: PublicKey;
};

function resolveStudioDbc(): string | null {
  const candidates = [
    '@meteora-invent/studio/dist/lib/dbc/index.js',
    path.join(process.cwd(), '../../studio/dist/lib/dbc/index.js'),
    path.join(process.cwd(), '../../studio/src/lib/dbc/index.ts'),
  ];
  for (const c of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require.resolve(c);
    } catch {
      /* skip */
    }
  }
  return null;
}

async function importDbcRuntime(): Promise<any> {
  const target = resolveStudioDbc();
  if (!target)
    throw new Error('Studio DBC module not found (build studio or keep it in the monorepo).');
  // @ts-expect-error webpackIgnore allows path import on Next server
  const mod = await import(/* webpackIgnore: true */ target);
  if (!mod) throw new Error('Failed to import DBC runtime.');
  return mod;
}

function pickClaimBuilder(
  mod: any
):
  | ((args: Record<string, unknown>) => Promise<TransactionInstruction | TransactionInstruction[]>)
  | null {
  return (
    mod?.buildClaimTradingFeeIx ||
    mod?.claimTradingFeeIx ||
    (mod?.builders && (mod.builders.buildClaimTradingFeeIx || mod.builders.claimTradingFee)) ||
    null
  );
}

/**
 * Returns a **single** instruction to claim DBC trading fees into `feeClaimer`.
 * Throws if the builder cannot be found or returns empty.
 */
export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey;
}): Promise<TransactionInstruction> {
  const { connection, poolKeys, feeClaimer } = args;

  const dbc = await importDbcRuntime();
  const claimBuilder = pickClaimBuilder(dbc);
  if (!claimBuilder) {
    throw new Error('DBC claim fee builder not found in studio runtime.');
    // ensures we never return undefined (fixes TS2322)
  }

  const maybe = await claimBuilder({
    pool: poolKeys.pool,
    feeVault: poolKeys.feeVault,
    claimer: feeClaimer,
    connection,
  });

  const out = Array.isArray(maybe) ? maybe[0] : maybe;
  if (!out) throw new Error('DBC claim fee builder returned no instruction.');
  return out as TransactionInstruction;
}
