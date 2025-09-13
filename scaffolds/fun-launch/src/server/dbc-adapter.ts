import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

export type DbcPoolKeys = {
  pool: PublicKey;
  feeVault: PublicKey;
};

const requireNode = createRequire(import.meta.url);

/** Resolve a file inside @meteora-invent/studio/dist reliably in serverless. */
function resolveStudioDist(subpath: string): string | null {
  try {
    const pkg = requireNode.resolve('@meteora-invent/studio/package.json');
    const base = path.dirname(pkg);
    const candidate = path.join(base, 'dist', subpath);
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function requireStudioModule(subpath: string): any | null {
  const target = resolveStudioDist(subpath);
  if (!target) return null;
  return requireNode(target);
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
  const mod = requireStudioModule('lib/dbc/index.js');
  if (!mod) throw new Error('DBC runtime not found (studio dist missing).');

  const builder =
    mod.buildClaimTradingFeeIx ||
    mod.claimTradingFeeIx ||
    (mod.builders && (mod.builders.buildClaimTradingFeeIx || mod.builders.claimTradingFee)) ||
    null;

  if (!builder) {
    throw new Error('DBC claim fee builder not found in Studio runtime.');
  }

  // Prefer object-arg form; fall back to positional if needed
  try {
    const ix: TransactionInstruction = await builder({
      connection: args.connection,
      poolKeys: { pool: args.poolKeys.pool, feeVault: args.poolKeys.feeVault },
      feeClaimer: args.feeClaimer,
    });
    return ix;
  } catch {
    const ix: TransactionInstruction = await builder(
      args.connection,
      { pool: args.poolKeys.pool, feeVault: args.poolKeys.feeVault },
      args.feeClaimer
    );
    return ix;
  }
}
