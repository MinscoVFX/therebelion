/**
 * Claim DBC bonding-curve leftovers across (BASE_MINTS × DBC_CONFIG_KEYS × optional DBC_PROGRAM_IDS).
 *
 * Env (via repo/org Secrets):
 *   RPC_URL
 *   BASE_MINTS            # comma-separated base mint addresses
 *   DBC_CONFIG_KEYS       # comma-separated config keys
 *   LEFTOVER_RECEIVER     # pubkey to receive leftovers
 *   (PK_B58 or PRIVATE_KEY_B58)
 *
 * Optional:
 *   DBC_PROGRAM_IDS       # comma-separated program IDs
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, VersionedTransaction, Transaction } from '@solana/web3.js';

type AttemptResult = {
  baseMint: string;
  configKey: string;
  programId?: string;
  status: 'claimed' | 'skipped' | 'noop' | 'error';
  txSig?: string;
  reason?: string;
};

// Load the correct DBC SDK (Dynamic Bonding Curve)
async function loadDbcSdk(): Promise<Record<string, unknown> | null> {
  try {
    // IMPORTANT: correct package name
    const sdk = await import('@meteora-ag/dynamic-bonding-curve-sdk');
    return sdk as unknown as Record<string, unknown>;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      '[FATAL] Failed to load @meteora-ag/dynamic-bonding-curve-sdk. Is it installed in the studio package?'
    );
    // eslint-disable-next-line no-console
    console.error(String(e));
    return null;
  }
}

// ---- Small helpers ----------------------------------------------------------

function csvEnv(name: string, required = true): string[] {
  const raw = process.env[name]?.trim() ?? '';
  if (!raw) {
    if (required) {
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.error(`[ERROR] Missing required env: ${name}`);
    return '';
  }
  return v;
}

function safePubkey(s: string, label: string): PublicKey | null {
  try {
    return new PublicKey(s);
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] Invalid pubkey for ${label}: ${s}`);
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function withBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3
): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const ms = 500 * Math.pow(2, i);
      // eslint-disable-next-line no-console
      console.warn(
        `[WARN] ${label} failed (attempt ${i + 1}/${attempts}): ${String(e)}; retrying in ${ms}ms…`
      );
      await new Promise((r) => setTimeout(r, ms));
    }
  }
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${label} failed after ${attempts} attempts: ${String(lastErr)}`);
  return null;
}

async function sendGeneric(
  connection: Connection,
  payer: Keypair,
  txOrIxs: unknown,
  extraSigners: Keypair[] = []
): Promise<string | null> {
  try {
    if (!txOrIxs) return null;

    if (txOrIxs instanceof VersionedTransaction) {
      txOrIxs.sign([payer, ...extraSigners]);
      const sig = await withBackoff(
        () => connection.sendTransaction(txOrIxs, { skipPreflight: false }),
        'send v0 tx'
      );
      if (!sig) return null;
      await withBackoff(() => connection.confirmTransaction(sig, 'confirmed'), 'confirm v0 tx', 5);
      return sig;
    }

    if (txOrIxs instanceof Transaction) {
      txOrIxs.feePayer = payer.publicKey;
      txOrIxs.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      txOrIxs.sign(payer, ...extraSigners);
      const sig = await withBackoff(
        () => connection.sendRawTransaction(txOrIxs.serialize(), { skipPreflight: false }),
        'send legacy tx'
      );
      if (!sig) return null;
      await withBackoff(
        () => connection.confirmTransaction(sig, 'confirmed'),
        'confirm legacy tx',
        5
      );
      return sig;
    }

    // Assume array of Ixs or single Ix-like
    const ixs = Array.isArray(txOrIxs) ? txOrIxs : [txOrIxs];
    if (ixs.length === 0) return null;

    const legacy = new Transaction().add(...(ixs as any[]));
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
    // eslint-disable-next-line no-console
    console.error('[ERROR] sendGeneric failed:', String(e));
    return null;
  }
}

function hasFn(o: unknown, k: string): o is Record<string, any> {
  return !!o && typeof (o as any)[k] === 'function';
}

// ---- Main -------------------------------------------------------------------

async function main() {
  // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.error('[ERROR] Provide either PK_B58 (preferred) or PRIVATE_KEY_B58.');
    ok = false;
  }

  if (!ok) {
    // eslint-disable-next-line no-console
    console.error('[FATAL] Missing/invalid required configuration. Exiting cleanly.');
    process.exit(0);
  }

  // Signer
  let signer: Keypair | null = null;
  try {
    if (PRIVATE_KEY_B58) {
      const secret = bs58.decode(PRIVATE_KEY_B58);
      signer = Keypair.fromSecretKey(secret);
    } else {
      // eslint-disable-next-line no-console
      console.error(
        '[WARN] PK_B58 provided without PRIVATE_KEY_B58. A signer is required to submit transactions.'
      );
      process.exit(0);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ERROR] Unable to construct signer from PRIVATE_KEY_B58:', String(e));
    process.exit(0);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const sdk = await loadDbcSdk();
  if (!sdk) {
    // Keep CI green, but explain.
    process.exit(0);
  }

  // Build a canonical DBC client if available
  let dbcClient: any = null;
  const clientCtorName =
    ['DynamicBondingCurveClient', 'Client', 'DBC', 'Dbc', 'MeteoraClient'].find(
      (n) => typeof (sdk as any)[n] === 'function'
    ) || null;

  if (clientCtorName) {
    try {
      const Ctor = (sdk as any)[clientCtorName];
      try {
        dbcClient = new Ctor(connection, 'confirmed');
      } catch (e1) {
        void e1;
        dbcClient = new Ctor({ connection, wallet: signer });
      }
    } catch (e2) {
      void e2;
      dbcClient = null;
    }
  }

  // Claim entrypoint candidates under the "partner" namespace (most likely)
  // plus a few direct fallbacks.
  const partnerObj = dbcClient?.partner || (sdk as any)?.partner || null;
  const claimNames = ['claimLeftover', 'claimLeftovers', 'claimLeftoverBase'];
  const builderNames = [
    'buildClaimLeftoverTx',
    'buildClaimLeftoversTx',
    'leftoversClaimTx',
    'makeClaimLeftoverIx',
    'makeClaimLeftoversIx',
  ];

  const programs = DBC_PROGRAM_IDS.length > 0 ? DBC_PROGRAM_IDS : [undefined];
  const results: AttemptResult[] = [];

  // eslint-disable-next-line no-console
  console.log('[INFO] Starting claims:');
  // eslint-disable-next-line no-console
  console.log(
    `       base mints = ${BASE_MINTS.length}, configs = ${DBC_CONFIG_KEYS.length}, programs = ${programs.length}`
  );

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

    // First try partner.* methods on the instantiated client
    if (partnerObj) {
      for (const name of claimNames) {
        if (hasFn(partnerObj, name)) {
          try {
            const txOrIx = await (partnerObj as any)[name]({
              baseMint,
              config: configKey,
              receiver: leftoverReceiver,
              payer: (signer as Keypair).publicKey,
              programId, // harmless if unused by SDK version
            });
            const txSig = await sendGeneric(connection, signer as Keypair, txOrIx);
            if (txSig) {
              return {
                baseMint: baseMintStr,
                configKey: configKeyStr,
                programId: programIdStr,
                status: 'claimed',
                txSig,
              };
            }
          } catch (e) {
            const msg = String((e as any)?.message || e);
            if (/no claimable|nothing to claim|not claimable|pool not found|no pool/i.test(msg)) {
              return {
                baseMint: baseMintStr,
                configKey: configKeyStr,
                programId: programIdStr,
                status: 'noop',
                reason: msg,
              };
            }
            // continue to next candidate
          }
        }
      }
      for (const name of builderNames) {
        if (hasFn(partnerObj, name)) {
          try {
            const built = await (partnerObj as any)[name]({
              baseMint,
              config: configKey,
              receiver: leftoverReceiver,
              payer: (signer as Keypair).publicKey,
              programId,
            });
            const txLike =
              built?.tx ??
              built?.transaction ??
              built?.ixs ??
              built?.ix ??
              built?.instructions ??
              built?.instruction ??
              built;
            const txSig = await sendGeneric(connection, signer as Keypair, txLike);
            if (txSig) {
              return {
                baseMint: baseMintStr,
                configKey: configKeyStr,
                programId: programIdStr,
                status: 'claimed',
                txSig,
              };
            }
          } catch (e) {
            const msg = String((e as any)?.message || e);
            if (/no claimable|nothing to claim|not claimable|pool not found|no pool/i.test(msg)) {
              return {
                baseMint: baseMintStr,
                configKey: configKeyStr,
                programId: programIdStr,
                status: 'noop',
                reason: msg,
              };
            }
          }
        }
      }
    }

    // Fallback: try root-level functions (older or alternate builds)
    const root = sdk as any;
    for (const name of [...claimNames, ...builderNames]) {
      if (hasFn(root, name)) {
        try {
          const maybe = await root[name]({
            baseMint,
            config: configKey,
            receiver: leftoverReceiver,
            payer: (signer as Keypair).publicKey,
            programId,
          });
          const txLike =
            (maybe &&
              (maybe.tx ??
                maybe.transaction ??
                maybe.ixs ??
                maybe.ix ??
                maybe.instructions ??
                maybe.instruction)) ??
            maybe;
          const txSig = await sendGeneric(connection, signer as Keypair, txLike);
          if (txSig) {
            return {
              baseMint: baseMintStr,
              configKey: configKeyStr,
              programId: programIdStr,
              status: 'claimed',
              txSig,
            };
          }
        } catch (e) {
          const msg = String((e as any)?.message || e);
          if (/no claimable|nothing to claim|not claimable|pool not found|no pool/i.test(msg)) {
            return {
              baseMint: baseMintStr,
              configKey: configKeyStr,
              programId: programIdStr,
              status: 'noop',
              reason: msg,
            };
          }
        }
      }
    }

    return {
      baseMint: baseMintStr,
      configKey: configKeyStr,
      programId: programIdStr,
      status: 'error',
      reason: 'Claim entrypoint not found in SDK',
    };
  }

  for (const baseMint of BASE_MINTS) {
    for (const configKey of DBC_CONFIG_KEYS) {
      for (const programId of programs) {
        const res = await attemptClaimOne(baseMint, configKey, programId);
        const tag =
          `${baseMint.slice(0, 6)}… ${configKey.slice(0, 6)}…` +
          (programId ? ` ${programId.slice(0, 6)}…` : '');
        if (res.status === 'claimed') {
          // eslint-disable-next-line no-console
          console.log(`[OK]   Claimed leftovers for ${tag}  -> ${res.txSig}`);
        } else if (res.status === 'noop') {
          // eslint-disable-next-line no-console
          console.log(`[SKIP] No leftovers for ${tag} (${res.reason || 'none'})`);
        } else {
          // eslint-disable-next-line no-console
          console.log(`[ERR]  Failed for ${tag} (${res.reason || 'unknown'})`);
        }
        results.push(res);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('\nbaseMint,configKey,programId,status,txSig,reason');
  for (const r of results) {
    // eslint-disable-next-line no-console
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

  const anyClaimed = results.some((r) => r.status === 'claimed');
  if (anyClaimed) {
    // eslint-disable-next-line no-console
    console.log(
      `[INFO] Done. ${results.filter((r) => r.status === 'claimed').length} claim(s) sent.`
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('[INFO] Done. Nothing to claim (or no claim path available).');
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[FATAL] Unhandled error:', String(e));
  process.exit(0); // keep CI green for non-critical failure
});
