import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import path from 'path';
import fs from 'fs';

export type DbcPoolKeys = {
  pool: PublicKey;
  feeVault: PublicKey;
};

function resolveStudioDist(subpath: string): string | null {
  try {
    const pkg = require.resolve('@meteora-invent/studio/package.json');
    const base = path.dirname(pkg);
    const candidate = path.join(base, 'dist', subpath);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
async function importStudioModule(subpath: string): Promise<any | null> {
  const target = resolveStudioDist(subpath);
  if (!target) return null;
  // @ts-ignore
  const mod = await import(/* webpackIgnore: true */ target);
  return mod ?? null;
}

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

  if (!builder) throw new Error('DBC claim fee builder not found in Studio runtime.');

  try {
    return await builder({
      connection: args.connection,
      poolKeys: { pool: args.poolKeys.pool, feeVault: args.poolKeys.feeVault },
      feeClaimer: args.feeClaimer,
    });
  } catch {
    return await builder(args.connection, args.poolKeys, args.feeClaimer);
  }
}
