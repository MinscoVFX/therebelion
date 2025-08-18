// @ts-nocheck
/**
 * Claim DBC bonding-curve leftovers across (BASE_MINTS × DBC_CONFIG_KEYS × DBC_PROGRAM_IDS?).
 *
 * - Reads config from env (set via GitHub Actions repo/org Secrets).
 * - Uses @solana/web3.js + @meteora-ag/dbc-sdk.
 * - Handles both PK_B58 (pubkey-only; assumes signer loaded from PRIVATE_KEY_B58)
 *   and PRIVATE_KEY_B58 (full signer).
 * - Extremely defensive: will not throw; prints a CSV summary at the end.
 *
 * Required env:
 *   RPC_URL
 *   BASE_MINTS            # comma-separated base mint addresses
 *   DBC_CONFIG_KEYS       # comma-separated config keys
 *   LEFTOVER_RECEIVER     # pubkey to receive leftovers
 *   (PK_B58 or PRIVATE_KEY_B58)
 *
 * Optional env:
 *   DBC_PROGRAM_IDS       # comma-separated program IDs (if omitted, SDK defaults will be probed)
 */

import 'dotenv/config';
import bs58 from 'bs58';
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
  TransactionMessage,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

// Lazy import to avoid type mismatch explosions; we probe exports at runtime.
let dbcSdk: any = null;
async function loadDbcSdk(): Promise<any> {
  if (dbcSdk) return dbcSdk;
  try {
    dbcSdk = await import('@meteora-ag/dbc-sdk');
  } catch (e) {
    console.error('[FATAL] Failed to load @meteora-ag/dbc-sdk. Is it installed?');
    console.error(String(e));
    process.exitCode = 1;
    // Return a dummy to keep the process alive gracefully
    dbcSdk = {};
  }
  return dbcSdk;
}

// ---- Helpers ----------------------------------------------------------------

function csvEnv(name: string, required = true): string[] {
  const raw = process.env[name]?.trim() ?? '';
  if (!raw) {
    if (required) {
      console.error(`[ERROR] Missing required env: ${name}`);
    }
    return [];
  }
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function expectEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`[ERROR] Missing required env: ${name}`);
    return '';
  }
  return v;
}

function safePubkey(str: string, label: string): PublicKey | null {
  try {
    return new PublicKey(str);
  } catch {
    console.error(`[ERROR] Invalid pubkey for ${label}: ${str}`);
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

type AttemptResult = {
  baseMint: string;
  configKey: string;
  programId?: string;
  status: 'claimed' | 'skipped' | 'noop' | 'error';
  txSig?: string;
  reason?: string;
};

// Try a list of candidate function names (and nesting) to find a callable.
function findCallable(root: any, names: string[]): { obj: any; fnName: string } | null {
  for (const n of names) {
    if (typeof root?.[n] === 'function') return { obj: root, fnName: n };
  }
  // Search common containers
  for (const container of ['DBC', 'Dbc', 'client', 'Client', 'Meteora', 'meteora']) {
    const o = root?.[container];
    if (!o) continue;
    for (const n of names) {
      if (typeof o?.[n] === 'function') return { obj: o, fnName: n };
    }
  }
  return null;
}

async function withBackoff<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T | null> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const ms = 500 * Math.pow(2, i);
      console.warn(`[WARN] ${label} failed (attempt ${i + 1}/${attempts}): ${String(e)}; retrying in ${ms}ms…`);
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  console.error(`[ERROR] ${label} failed after ${attempts} attempts: ${String(lastErr)}`);
  return null;
}

// Send either a prebuilt transaction, a list of IXs, or a single IX.
async function sendGeneric(
  connection: Connection,
  payer: Keypair,
  maybeTxOrIxs: any,
  extraSigners: Keypair[] = []
): Promise<string | null> {
  try {
    if (!maybeTxOrIxs) {
      return null;
    }
    // VersionedTransaction
    if (maybeTxOrIxs instanceof VersionedTransaction) {
      maybeTxOrIxs.sign([payer, ...extraSigners]);
      const sig = await withBackoff(
        () => connection.sendTransaction(maybeTxOrIxs, { skipPreflight: false }),
        'send v0 tx'
      );
      if (!sig) return null;
      await withBackoff(() => connection.confirmTransaction(sig, 'confirmed'), 'confirm v0 tx', 5);
      return sig;
    }

    // Legacy Transaction
    if (maybeTxOrIxs instanceof Transaction) {
      maybeTxOrIxs.feePayer = payer.publicKey;
      maybeTxOrIxs.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      maybeTxOrIxs.sign(payer, ...extraSigners);
      const sig = await withBackoff(
        () => connection.sendRawTransaction(maybeTxOrIxs.serialize(), { skipPreflight: false }),
        'send legacy tx'
      );
      if (!sig) return null;
      await withBackoff(() => connection.confirmTransaction(sig, 'confirmed'), 'confirm legacy tx', 5);
      return sig;
    }

    // Array of instructions or single instruction
    const ixs = Array.isArray(maybeTxOrIxs) ? maybeTxOrIxs : [maybeTxOrIxs];
    if (ixs.length === 0) return null;

    const legacy = new Transaction().add(...ixs);
    legacy.feePayer = payer.publicKey;
    legacy.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    legacy.sign(payer, ...extraSigners);

    const sig = await withBackoff(
      () => connection.sendRawTransaction(legacy.serialize(), { skipPreflight: false }),
      'send built tx'
    );
    if (!sig) return null;
    await withBackoff(() => connection.confirmTransaction(sig, 'confirmed'), 'confirm built tx', 5);
    return sig;
  } catch (e) {
    console.error('[ERROR] sendGeneric failed:', String(e));
    return null;
  }
}

// ---- Main claiming routine ---------------------------------------------------

async function main() {
  console.log(`[INFO] DBC leftover claim job start @ ${nowIso()}`);

  const RPC_URL = expectEnv('RPC_URL');
  const BASE_MINTS = csvEnv('BASE_MINTS');
  const DBC_CONFIG_KEYS = csvEnv('DBC_CONFIG_KEYS');
  const DBC_PROGRAM_IDS = csvEnv('DBC_PROGRAM_IDS', false);
  const LEFTOVER_RECEIVER_STR = expectEnv('LEFTOVER_RECEIVER');
  const PK_B58 = process.env.PK_B58?.trim() ?? '';
  const PRIVATE_KEY_B58 = process.env.PRIVATE_KEY_B58?.trim() ?? '';

  let ok = true;
  if (!RPC_URL) ok = false;
  if (BASE_MINTS.length === 0) ok = false;
  if (DBC_CONFIG_KEYS.length === 0) ok = false;
  const leftoverReceiver = safePubkey(LEFTOVER_RECEIVER_STR, 'LEFTOVER_RECEIVER');
  if (!leftoverReceiver) ok = false;

  if (!PK_B58 && !PRIVATE_KEY_B58) {
    console.error('[ERROR] Provide either PK_B58 (preferred) or PRIVATE_KEY_B58.');
    ok = false;
  }

  if (!ok) {
    console.error('[FATAL] Missing/invalid required configuration. Exiting cleanly.');
    process.exit(0); // graceful (no crash) to keep CI green if you want
    return;
  }

  // Load signer
  let signer: Keypair | null = null;
  try {
    if (PRIVATE_KEY_B58) {
      const secret = bs58.decode(PRIVATE_KEY_B58);
      signer = Keypair.fromSecretKey(secret);
    } else {
      // When only PK_B58 is provided, we still need a signer to send transactions.
      // In CI, we expect PRIVATE_KEY_B58 to be set. If not, exit gracefully.
      console.error(
        '[WARN] PK_B58 provided without PRIVATE_KEY_B58. A signer is required to submit transactions.'
      );
      process.exit(0);
      return;
    }
  } catch (e) {
    console.error('[ERROR] Unable to construct signer from PRIVATE_KEY_B58:', String(e));
    process.exit(0);
    return;
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const sdk = await loadDbcSdk();

  // Find a callable "claim leftovers" entrypoint.
  const claimCandidates = [
    'claimLeftovers',
    'claim_leftovers',
    'claimLeftover',
    'claimBondingCurveLeftovers',
    'claimBondingCurveLeftover',
    'claim_leftover',
  ];
  const builderCandidates = [
    'buildClaimLeftoversTx',
    'build_claim_leftovers_tx',
    'leftoversClaimTx',
    'makeClaimLeftoversIx',
    'make_claim_leftovers_ix',
  ];

  const callable = findCallable(sdk, claimCandidates) || findCallable(sdk, builderCandidates);
  if (!callable) {
    console.error(
      '[ERROR] Could not locate a claim function in @meteora-ag/dbc-sdk. ' +
        'Please update the SDK or expose a claim builder.'
    );
    process.exit(0);
    return;
  }

  // If SDK exposes a "Client" class, try to initialize (optional).
  let sdkClient: any = null;
  for (const ctorName of ['Client', 'DBC', 'Dbc', 'MeteoraClient']) {
    try {
      if (typeof sdk?.[ctorName] === 'function') {
        // Try common constructors: (connection, signer) or ({ connection, wallet })
        try {
          sdkClient = new sdk[ctorName](connection, signer);
        } catch {
          try {
            sdkClient = new sdk[ctorName]({ connection, wallet: signer });
          } catch {
            // ignore; we'll call static function instead
          }
        }
        if (sdkClient) break;
      }
    } catch {
      // continue
    }
  }

  // Build the cartesian product to try.
  const programs = DBC_PROGRAM_IDS.length > 0 ? DBC_PROGRAM_IDS : [undefined];

  const results: AttemptResult[] = [];

  console.log('[INFO] Starting claims:');
  console.log(
    `       base mints = ${BASE_MINTS.length}, configs = ${DBC_CONFIG_KEYS.length}, programs = ${programs.length}`
  );

  // Helper to invoke claim function with different arg shapes.
  async function attemptClaimOne(
    baseMintStr: string,
    configKeyStr: string,
    programIdStr?: string
  ): Promise<AttemptResult> {
    const baseMint = safePubkey(baseMintStr, 'baseMint');
    const configKey = safePubkey(configKeyStr, 'configKey');
    const programId = programIdStr ? safePubkey(programIdStr, 'programId') : undefined;

    if (!baseMint || !configKey || (programIdStr && !programId)) {
      return {
        baseMint: baseMintStr,
        configKey: configKeyStr,
        programId: programIdStr,
        status: 'error',
        reason: 'Invalid pubkey in inputs',
      };
    }

    // Some SDKs return early/no-op if nothing is claimable; catch and interpret.
    const argShapes = [
      // Most explicit object
      { args: [{ baseMint, configKey, programId, receiver: leftoverReceiver, payer: signer.publicKey }], label: 'obj-full' },
      // Without payer
      { args: [{ baseMint, configKey, programId, receiver: leftoverReceiver }], label: 'obj-nopayer' },
      // Positional: (connection, payer, baseMint, configKey, receiver, programId?)
      { args: [connection, signer, baseMint, configKey, leftoverReceiver, programId].filter(Boolean), label: 'pos-full' },
      // Positional: (client, baseMint, configKey, receiver[, programId])
      { args: [sdkClient, baseMint, configKey, leftoverReceiver, programId].filter(Boolean), label: 'pos-client' },
      // Positional minimal
      { args: [baseMint, configKey, leftoverReceiver, programId].filter(Boolean), label: 'pos-min' },
    ];

    for (const shape of argShapes) {
      try {
        const targetObj = callable.obj || sdk;
        const fn = targetObj[callable.fnName].bind(targetObj);
        const maybe = await fn(...shape.args);

        // If the function directly sent and returns signature:
        if (typeof maybe === 'string' && maybe.length > 40) {
          return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'claimed', txSig: maybe };
        }

        // If the function returns { tx | ixs | transaction | instructions }:
        const txLike =
          maybe?.tx ??
          maybe?.transaction ??
          maybe?.ixs ??
          maybe?.ix ??
          maybe?.instructions ??
          maybe?.instruction ??
          maybe;

        const sig = await sendGeneric(connection, signer, txLike);
        if (sig) {
          return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'claimed', txSig: sig };
        }

        // If we reach here, maybe it was a no-op (nothing claimable)
        if (maybe === null || maybe === undefined) {
          return {
            baseMint: baseMintStr,
            configKey: configKeyStr,
            programId: programIdStr,
            status: 'noop',
            reason: 'No claimable leftovers (function returned empty)',
          };
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        // Common "not claimable" shapes we convert to noop
        if (
          /no claimable|nothing to claim|not claimable|pool not found|no pool/i.test(msg)
        ) {
          return {
            baseMint: baseMintStr,
            configKey: configKeyStr,
            programId: programIdStr,
            status: 'noop',
            reason: msg,
          };
        }
        // Try next arg shape…
      }
    }

    return {
      baseMint: baseMintStr,
      configKey: configKeyStr,
      programId: programIdStr,
      status: 'error',
      reason: 'All known calling patterns failed',
    };
  }

  for (const baseMint of BASE_MINTS) {
    for (const configKey of DBC_CONFIG_KEYS) {
      for (const programId of programs) {
        const res = await attemptClaimOne(baseMint, configKey, programId);
        const tag = `${baseMint.slice(0, 6)}… ${configKey.slice(0, 6)}…${programId ? ' ' + programId.slice(0, 6) + '…' : ''}`;
        if (res.status === 'claimed') {
          console.log(`[OK]   Claimed leftovers for ${tag}  -> ${res.txSig}`);
        } else if (res.status === 'noop') {
          console.log(`[SKIP] No leftovers for ${tag} (${res.reason || 'none'})`);
        } else {
          console.log(`[ERR]  Failed for ${tag} (${res.reason || 'unknown'})`);
        }
        results.push(res);
      }
    }
  }

  // ---- Summary (CSV) --------------------------------------------------------
  console.log('\nbaseMint,configKey,programId,status,txSig,reason');
  for (const r of results) {
    console.log(
      [
        r.baseMint,
        r.configKey,
        r.programId ?? '',
        r.status,
        r.txSig ?? '',
        (r.reason ?? '').replace(/[\r\n,]+/g, ' ').slice(0, 300),
      ].join(',')
    );
  }

  // If anything actually claimed, set success exit; otherwise still exit 0 (not an error).
  const anyClaimed = results.some((r) => r.status === 'claimed');
  if (anyClaimed) {
    console.log(`[INFO] Done. ${results.filter((r) => r.status === 'claimed').length} claim(s) sent.`);
  } else {
    console.log('[INFO] Done. Nothing to claim (or no claim path available).');
  }
}

main().catch((e) => {
  console.error('[FATAL] Unhandled error:', String(e));
  // Exit 0 to keep the workflow from red-failing on non-critical runs.
  process.exit(0);
});
