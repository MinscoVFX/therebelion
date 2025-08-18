/**
 * Claim DBC bonding-curve leftovers across (BASE_MINTS × DBC_CONFIG_KEYS × optional DBC_PROGRAM_IDS).
 * Secrets: RPC_URL, BASE_MINTS, DBC_CONFIG_KEYS, LEFTOVER_RECEIVER, (PK_B58 or PRIVATE_KEY_B58)
 * Optional: DBC_PROGRAM_IDS
 */
import 'dotenv/config';
import bs58 from 'bs58';
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  Transaction,
} from '@solana/web3.js';

type AttemptResult = {
  baseMint: string;
  configKey: string;
  programId?: string;
  status: 'claimed' | 'skipped' | 'noop' | 'error';
  txSig?: string;
  reason?: string;
};

async function loadDbcSdk(): Promise<Record<string, unknown> | null> {
  const candidates = ['@meteora-ag/dbc-sdk', '@meteora-ag/dynamic-bonding-curve-sdk'];
  for (const mod of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const sdk = await import(mod);
      console.log(`[INFO] Loaded Meteora SDK: ${mod}`);
      return sdk as Record<string, unknown>;
    } catch (_) {}
  }
  console.error('[FATAL] Failed to load Meteora DBC SDK (tried dbc-sdk and dynamic-bonding-curve-sdk).');
  return null;
}

// ---------- helpers ----------
function csvEnv(name: string, required = true): string[] {
  const raw = process.env[name]?.trim() ?? '';
  if (!raw) {
    if (required) console.error(`[ERROR] Missing required env: ${name}`);
    return [];
  }
  return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}
function expectEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`[ERROR] Missing required env: ${name}`);
    return '';
  }
  return v;
}
function safePubkey(s: string, label: string): PublicKey | null {
  try { return new PublicKey(s); }
  catch { console.error(`[ERROR] Invalid pubkey for ${label}: ${s}`); return null; }
}
function nowIso() { return new Date().toISOString(); }

async function withBackoff<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const ms = 500 * Math.pow(2, i);
      console.warn(`[WARN] ${label} failed (${i + 1}/${attempts}): ${String(e)}; retrying in ${ms}ms…`);
      await new Promise((r) => setTimeout(r, ms));
    }
  }
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
      const sig = await withBackoff(() => connection.sendTransaction(txOrIxs, { skipPreflight: false }), 'send v0 tx');
      if (!sig) return null;
      await withBackoff(() => connection.confirmTransaction(sig, 'confirmed'), 'confirm v0 tx', 5);
      return sig;
    }

    if (txOrIxs instanceof Transaction) {
      txOrIxs.feePayer = payer.publicKey;
      txOrIxs.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      txOrIxs.sign(payer, ...extraSigners);
      const sig = await withBackoff(() => connection.sendRawTransaction(txOrIxs.serialize(), { skipPreflight: false }), 'send legacy tx');
      if (!sig) return null;
      await withBackoff(() => connection.confirmTransaction(sig, 'confirmed'), 'confirm legacy tx', 5);
      return sig;
    }

    const ixs = Array.isArray(txOrIxs) ? txOrIxs : [txOrIxs];
    if (ixs.length === 0) return null;

    const legacy = new Transaction().add(...(ixs as any[]));
    legacy.feePayer = payer.publicKey;
    legacy.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    legacy.sign(payer, ...extraSigners);

    const sig = await withBackoff(() => connection.sendRawTransaction(legacy.serialize(), { skipPreflight: false }), 'send built tx');
    if (!sig) return null;
    await withBackoff(() => connection.confirmTransaction(sig, 'confirmed'), 'confirm built tx', 5);
    return sig;
  } catch (e) {
    console.error('[ERROR] sendGeneric failed:', String(e));
    return null;
  }
}

// brute-force search of callable names in root or nested containers
function findCallableDeep(root: Record<string, unknown> | null) {
  if (!root) return null as { obj: any; fnName: string } | null;
  const nameMatches = (n: string) => /(left.*over|claim.*left|withdraw.*left)/i.test(n);

  const tryObj = (obj: any): { obj: any; fnName: string } | null => {
    if (!obj) return null;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'function' && nameMatches(key)) return { obj, fnName: key };
    }
    return null;
  };

  // first pass: root exports
  const direct = tryObj(root);
  if (direct) return direct;

  // second pass: common containers
  const containers = [
    'DBC', 'Dbc', 'client', 'Client', 'Meteora', 'meteora',
    'DynamicBondingCurveClient', 'DynamicBondingCurve', 'Sdk', 'SDK'
  ];
  for (const c of containers) {
    const o = (root as any)[c];
    const hit = tryObj(o);
    if (hit) return hit;
  }

  // third pass: scan nested plain objects one level deep
  for (const key of Object.keys(root)) {
    const v = (root as any)[key];
    if (v && typeof v === 'object') {
      const hit = tryObj(v);
      if (hit) return hit;
    }
  }

  return null as { obj: any; fnName: string } | null;
}

// ---------- main ----------
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
    process.exit(0);
  }

  // signer
  let signer: Keypair | null = null;
  try {
    if (PRIVATE_KEY_B58) {
      const secret = bs58.decode(PRIVATE_KEY_B58);
      signer = Keypair.fromSecretKey(secret);
    } else {
      console.error('[WARN] PK_B58 provided without PRIVATE_KEY_B58. A signer is required to submit transactions.');
      process.exit(0);
    }
  } catch (e) {
    console.error('[ERROR] Unable to construct signer from PRIVATE_KEY_B58:', String(e));
    process.exit(0);
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const sdk = await loadDbcSdk();
  if (!sdk) {
    process.exit(0);
  }

  // find a callable leftover entrypoint
  const callable =
    findCallableDeep(sdk); // regex scan across export names

  const programs = DBC_PROGRAM_IDS.length > 0 ? DBC_PROGRAM_IDS : [undefined];
  const results: AttemptResult[] = [];

  console.log('[INFO] Starting claims:');
  console.log(`       base mints = ${BASE_MINTS.length}, configs = ${DBC_CONFIG_KEYS.length}, programs = ${programs.length}`);

  async function attemptClaimOne(baseMintStr: string, configKeyStr: string, programIdStr?: string): Promise<AttemptResult> {
    const baseMint = safePubkey(baseMintStr, 'baseMint');
    const configKey = safePubkey(configKeyStr, 'configKey');
    const programId = programIdStr ? safePubkey(programIdStr, 'programId') : undefined;
    if (!baseMint || !configKey || (programIdStr && !programId)) {
      return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'error', reason: 'Invalid pubkey in inputs' };
    }

    // No callable? fail fast with a clear reason.
    if (!callable) {
      return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'error', reason: 'Claim entrypoint not found in SDK' };
    }

    // argument shapes commonly seen
    const argShapes = [
      { args: [{ baseMint, configKey, programId, receiver: (leftoverReceiver as PublicKey) }], label: 'obj' },
      { args: [baseMint, configKey, (leftoverReceiver as PublicKey), programId].filter(Boolean), label: 'pos-min' },
    ];

    for (const shape of argShapes) {
      try {
        const targetObj = (callable as any).obj || sdk;
        const fn = (targetObj as any)[(callable as any).fnName].bind(targetObj);
        const maybe = await fn(...shape.args);

        if (typeof maybe === 'string' && maybe.length > 40) {
          return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'claimed', txSig: maybe };
        }

        const txLike =
          (maybe && (maybe.tx ?? (maybe as any).transaction ?? (maybe as any).ixs ?? (maybe as any).ix ?? (maybe as any).instructions ?? (maybe as any).instruction)) ??
          maybe;

        const sig = await sendGeneric(connection, signer as Keypair, txLike);
        if (sig) {
          return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'claimed', txSig: sig };
        }

        if (maybe === null || maybe === undefined) {
          return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'noop', reason: 'No claimable leftovers (empty result)' };
        }
      } catch (e: unknown) {
        const msg = String((e as any)?.message || e);
        if (/no claimable|nothing to claim|not claimable|pool not found|no pool|not found/i.test(msg)) {
          return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'noop', reason: msg };
        }
      }
    }

    return { baseMint: baseMintStr, configKey: configKeyStr, programId: programIdStr, status: 'error', reason: 'All known calling patterns failed' };
  }

  for (const baseMint of BASE_MINTS) {
    for (const configKey of DBC_CONFIG_KEYS) {
      for (const programId of programs) {
        const res = await attemptClaimOne(baseMint, configKey, programId);
        const tag = `${baseMint.slice(0, 6)}… ${configKey.slice(0, 6)}…` + (programId ? ` ${programId.slice(0, 6)}…` : '');
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

  console.log('\nbaseMint,configKey,programId,status,txSig,reason');
  for (const r of results) {
    console.log([r.baseMint, r.configKey, r.programId ?? '', r.status, r.txSig ?? '', (r.reason ?? '').replace(/[\r\n,]+/g, ' ').slice(0, 300)].join(','));
  }

  const anyClaimed = results.some((r) => r.status === 'claimed');
  if (anyClaimed) {
    console.log(`[INFO] Done. ${results.filter((r) => r.status === 'claimed').length} claim(s) sent.`);
  } else {
    console.log('[INFO] Done. Nothing to claim (or no claim path available).');
  }
}

main().catch((e) => {
  console.error('[FATAL] Unhandled error:', String(e));
  process.exit(0);
});
