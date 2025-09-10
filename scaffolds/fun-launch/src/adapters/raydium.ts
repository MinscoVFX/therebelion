// scaffolds/fun-launch/src/adapters/raydium.ts
// Runtime-safe adapter for Raydium LaunchLab.
// - Dynamically imports the SDK so your app builds even if the package isn't installed yet.
// - Prepends your creation-fee transfer.
// - If SDK or helper fns aren't available, throws a typed error that the API maps to 501.

import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

export type MigrateType = 'amm' | 'cpmm';

export interface RaydiumCreateArgs {
  // creator wallet (payer & signer — supplied by client)
  creator: PublicKey;

  // platform config
  platformPda: PublicKey;         // env RAYDIUM_PLATFORM_PDA
  shareFeeBps: number;            // env RAYDIUM_SHARE_FEE_BPS
  creationFeeLamports: bigint;    // env RAYDIUM_CREATION_FEE_LAMPORTS
  creationFeeReceiver: PublicKey; // platform treasury / authority pubkey

  // token metadata
  name: string;
  symbol: string;
  decimals: number;
  imageUrl?: string;
  description?: string;

  // curve params
  supplyTokens: bigint;           // total token A to sell on curve
  raiseTargetLamports: bigint;    // SOL (lamports) to raise
  migrateType: MigrateType;       // 'amm' | 'cpmm'

  // vanity (optional): bring-your-own mint
  existingMint?: PublicKey;

  // LP lock behavior on migration (optional; respected if SDK supports it)
  lockLp?: boolean;
}

/** Build a simple SystemProgram transfer for your one-time creation fee. */
export function buildCreationFeeIx(
  from: PublicKey,
  to: PublicKey,
  lamports: bigint,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: to,
    lamports: Number(lamports),
  });
}

// Lazy loader for the Raydium SDK without triggering TS module resolution.
// Uses an eval-style dynamic import so typecheck passes even if the package isn't installed.
async function loadRaydiumSdk(): Promise<any> {
  try {
    // Avoid static import() so TS doesn't try to resolve types
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const mod = await dynamicImport('@raydium-io/raydium-sdk-v2');
    return mod;
  } catch {
    // SDK not installed or cannot be resolved at runtime.
    // Caller will convert this to a 501 response.
    // eslint-disable-next-line no-throw-literal
    throw { code: 'RAYDIUM_SDK_MISSING', message: 'Raydium SDK not installed' };
  }
}

/**
 * Build the create/init transaction for LaunchLab.
 * Always includes your creation-fee ix first.
 * Tries several common helper shapes in the SDK; if none match, throws RAYDIUM_NOT_WIRED.
 */
export async function buildCreateLaunchpadTx(args: RaydiumCreateArgs): Promise<Transaction> {
  const tx = new Transaction();

  // 1) Prepend your one-time creation fee (identical UX to Meteora DBC)
  tx.add(buildCreationFeeIx(args.creator, args.creationFeeReceiver, args.creationFeeLamports));

  // 2) Append LaunchLab init instructions via SDK (if present)
  const sdk = await loadRaydiumSdk(); // throws RAYDIUM_SDK_MISSING if absent
  const anySdk = sdk as any;

  // Try a few expected entry points to guard against minor API naming differences.
  const launchLab =
    anySdk?.LaunchLab ??
    anySdk?.launchLab ??
    anySdk?.RaydiumLaunchLab ??
    anySdk?.Raydium?.LaunchLab ??
    null;

  if (!launchLab) {
    // eslint-disable-next-line no-throw-literal
    throw {
      code: 'RAYDIUM_NOT_WIRED',
      message: 'LaunchLab helpers not found in Raydium SDK',
    };
  }

  // Prefer BYO mint (vanity) path if an existingMint is supplied; else convenience create+init.
  const useExisting = !!args.existingMint;

  // Candidate helper names we’ll probe for at runtime:
  const helperCandidates = useExisting
    ? [
        'buildInitializeWithExistingMint',
        'initializeWithExistingMint',
        'createPoolWithExistingMint',
      ]
    : [
        'buildCreateTokenAndInitialize',
        'createTokenAndInitialize',
        'createPoolWithNewMint',
      ];

  let ixs: TransactionInstruction[] | null = null;

  for (const fnName of helperCandidates) {
    const fn = (launchLab as any)[fnName];
    if (typeof fn !== 'function') continue;

    // Build a best-effort arg object used by most LaunchLab helpers.
    const commonArgs = {
      // Some SDKs expect a Connection; we are building a tx server-side without signing here.
      // If your helper requires a `connection`, adjust the API route to pass one and thread it here.
      creator: args.creator,
      platformPda: args.platformPda,
      metadata: {
        name: args.name,
        symbol: args.symbol,
        decimals: args.decimals,
        imageUrl: args.imageUrl ?? '',
        description: args.description ?? '',
      },
      shareFeeRateBps: args.shareFeeBps,
      totalSellTokens: args.supplyTokens,
      totalFundRaisingLamports: args.raiseTargetLamports,
      migrateType: args.migrateType,
      ...(typeof args.lockLp === 'boolean' ? { lockLp: args.lockLp } : {}), // pass through if provided
    };

    try {
      let resp: any;

      if (useExisting) {
        resp = await fn({
          ...commonArgs,
          mint: args.existingMint, // vanity path
        });
      } else {
        resp = await fn(commonArgs);
      }

      // Accept either { ixs } or a raw Instruction[] result.
      if (resp?.ixs && Array.isArray(resp.ixs)) {
        ixs = resp.ixs as TransactionInstruction[];
      } else if (Array.isArray(resp)) {
        ixs = resp;
      }

      if (ixs && ixs.length > 0) break;
    } catch (e) {
      // Try the next candidate; if all fail, throw NOT_WIRED below.
      // (We intentionally swallow here to allow fallback attempts.)
      // eslint-disable-next-line no-console
      console.warn(`Raydium helper "${fnName}" failed, trying next:`, e);
    }
  }

  if (!ixs || ixs.length === 0) {
    // eslint-disable-next-line no-throw-literal
    throw {
      code: 'RAYDIUM_NOT_WIRED',
      message: 'Could not build LaunchLab instructions from the SDK',
    };
  }

  ixs.forEach((ix) => tx.add(ix));
  return tx;
}

/**
 * Build platform-fee claim transaction.
 * This also attempts dynamic helper probing; throws NOT_WIRED if nothing matches.
 */
export async function buildClaimPlatformFeeTx(
  platformPda: PublicKey,
  recipient: PublicKey,
): Promise<Transaction> {
  const sdk = await loadRaydiumSdk(); // may throw RAYDIUM_SDK_MISSING
  const anySdk = sdk as any;
  const launchLab =
    anySdk?.LaunchLab ??
    anySdk?.launchLab ??
    anySdk?.RaydiumLaunchLab ??
    anySdk?.Raydium?.LaunchLab ??
    null;

  if (!launchLab) {
    // eslint-disable-next-line no-throw-literal
    throw {
      code: 'RAYDIUM_NOT_WIRED',
      message: 'LaunchLab helpers not found in Raydium SDK',
    };
  }

  const claimCandidates = ['buildClaimPlatformFee', 'claimPlatformFee'];
  let ixs: TransactionInstruction[] | null = null;

  for (const fnName of claimCandidates) {
    const fn = (launchLab as any)[fnName];
    if (typeof fn !== 'function') continue;

    try {
      const resp: any = await fn({
        platformPda,
        recipient,
      });

      if (resp?.ixs && Array.isArray(resp.ixs)) {
        ixs = resp.ixs as TransactionInstruction[];
      } else if (Array.isArray(resp)) {
        ixs = resp;
      }

      if (ixs && ixs.length > 0) break;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Raydium helper "${fnName}" failed, trying next:`, e);
    }
  }

  if (!ixs || ixs.length === 0) {
    // eslint-disable-next-line no-throw-literal
    throw {
      code: 'RAYDIUM_NOT_WIRED',
      message: 'Could not build claim instructions from the SDK',
    };
  }

  const tx = new Transaction();
  ixs.forEach((ix) => tx.add(ix));
  return tx;
}
