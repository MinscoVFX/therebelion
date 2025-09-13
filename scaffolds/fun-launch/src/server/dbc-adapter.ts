import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import path from 'path';

export type DbcPoolKeys = {
  pool: PublicKey;
  feeVault: PublicKey;
};

/** ----- Robust runtime resolution for Studio compiled JS (monorepo + Vercel) ----- */
function resolveStudio(pathInDist: string): string | null {
  try {
    return require.resolve(`@meteora-invent/studio/dist/${pathInDist}`);
  } catch {
    try {
      return path.join(process.cwd(), `../../studio/dist/${pathInDist}`);
    } catch {
      return null;
    }
  }
}

async function importStudioModule(pathInDist: string): Promise<any | null> {
  const target = resolveStudio(pathInDist);
  if (!target) return null;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - dynamic path; keep Next from bundling
  const mod = await import(/* webpackIgnore: true */ target);
  return mod ?? null;
}

/**
 * Build the DBC "claim trading fee" instruction for a given pool.
 * Finds the correct builder symbol across possible SDK versions/exports.
 */
export async function buildDbcClaimTradingFeeIx(args: {
  connection: Connection;
  poolKeys: DbcPoolKeys;
  feeClaimer: PublicKey;
}): Promise<TransactionInstruction> {
  const mod = await importStudioModule('lib/dbc/index.js');
  if (!mod) throw new Error('DBC runtime not found (studio dist missing).');

  const builder =
    mod.buildClaimTradingFeeIx ||
    mod.claimTradingFeeIx ||
    (mod.builders && (mod.builders.buildClaimTradingFeeIx || mod.builders.claimTradingFee)) ||
    null;

  if (!builder) {
    throw new Error('DBC claim fee builder not found in Studio runtime.');
  }

  // Support both object and positional arg styles (SDK variants)
  try {
    const ix: TransactionInstruction = await builder({
      connection: args.connection,
      poolKeys: { pool: args.poolKeys.pool, feeVault: args.poolKeys.feeVault },
      feeClaimer: args.feeClaimer,
    });
    return ix;
  } catch {
    const ix: TransactionInstruction = await builder(args.connection, args.poolKeys, args.feeClaimer);
    return ix;
  }
}
