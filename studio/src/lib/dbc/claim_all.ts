// studio/src/lib/dbc/claim_all.ts
import {
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  Keypair,
  TransactionInstruction,
} from "@solana/web3.js";
import * as DBC from "@meteora-ag/dynamic-bonding-curve-sdk";

type SignerLike = {
  publicKey?: PublicKey;
  signTransaction: (tx: VersionedTransaction | any) => Promise<any>;
};

export type ClaimAllOpts = {
  priorityMicrolamportsPerCU?: number;
  maxIxsPerTx?: number;
  skipIfNoFees?: boolean;
  setComputeUnitLimit?: number;
};

// ---- internal helpers -------------------------------------------------------

const asPubkey = (v: any): PublicKey => {
  if (v instanceof PublicKey) return v;
  if (v?.toBase58) {
    const s = v.toBase58();
    return new PublicKey(s);
  }
  if (typeof v === "string") return new PublicKey(v);
  if (v?.pubkey) return asPubkey(v.pubkey);
  if (v?.publicKey) return asPubkey(v.publicKey);
  // will throw if invalid (surface early)
  return new PublicKey(v);
};

const parsePubkeyList = (raw?: string | null): PublicKey[] => {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new PublicKey(s));
};

async function createDbcClient(connection: Connection): Promise<any | null> {
  // Try common creation shapes
  const C: any =
    (DBC as any).DbcClient ||
    (DBC as any).DBCClient ||
    (DBC as any).Client ||
    null;
  if (!C) return null;

  try {
    if (typeof C.create === "function") {
      const c = await C.create(connection);
      return c || null;
    }
  } catch {}
  try {
    // some SDKs just new up with (connection)
    // eslint-disable-next-line new-cap
    const c = new C(connection);
    return c || null;
  } catch {}
  return null;
}

function pickFn(obj: any, names: string[]): ((...a: any[]) => any) | null {
  for (const n of names) {
    const fn = obj?.[n];
    if (typeof fn === "function") return fn.bind(obj);
  }
  return null;
}

async function resolveFns(connection: Connection) {
  // Try top-level functions
  const top = DBC as any;

  // Optionally create a client, then probe instance methods
  const client = await createDbcClient(connection);

  // Functions to get pool-configs by owner
  const getPoolConfigsByOwner =
    pickFn(top, [
      "getPoolConfigsByOwner",
      "getPoolConfigsForOwner",
      "getPoolConfigs",
    ]) ||
    pickFn(top?.PoolConfig, ["getByOwner", "getAllByOwner"]) ||
    pickFn(client, [
      "getPoolConfigsByOwner",
      "getPoolConfigsForOwner",
      "fetchPoolConfigsByOwner",
      "listPoolConfigsByOwner",
    ]);

  // Functions to expand config → pools
  const getPoolsByConfig =
    pickFn(top, ["getPoolsByConfig"]) ||
    pickFn(top?.Pool, ["getByConfig", "getAllByConfig"]) ||
    pickFn(client, ["getPoolsByConfig", "listPoolsByConfig"]);

  // Fetch state (to skip 0-fee pools quickly)
  const fetchPoolState =
    pickFn(top, ["fetchPoolState"]) ||
    pickFn(top?.Pool, ["fetchState", "getState"]) ||
    pickFn(client, ["fetchPoolState", "getPoolState"]);

  // Build claim ix
  const buildClaimTradingFeesIx =
    pickFn(top, ["buildClaimTradingFeesIx"]) ||
    pickFn(top?.Pool, ["buildClaimTradingFeesIx"]) ||
    pickFn(client, ["buildClaimTradingFeesIx"]);

  return {
    client,
    getPoolConfigsByOwner,
    getPoolsByConfig,
    fetchPoolState,
    buildClaimTradingFeesIx,
  };
}

// ---- main -------------------------------------------------------------------

export async function claimAllTradingFeesForOwner(
  connection: Connection,
  owner: PublicKey,
  feeClaimer: PublicKey,
  signer: SignerLike,
  opts: ClaimAllOpts = {}
) {
  const {
    priorityMicrolamportsPerCU = 0,
    maxIxsPerTx = 14,
    skipIfNoFees = true,
    setComputeUnitLimit = 1_000_000,
  } = opts;

  const {
    getPoolConfigsByOwner,
    getPoolsByConfig,
    fetchPoolState,
    buildClaimTradingFeesIx,
  } = await resolveFns(connection);

  // 1) Discover pool configs for owner (or fallback to env)
  let poolConfigs: PublicKey[] = [];
  if (getPoolConfigsByOwner) {
    const raw = await getPoolConfigsByOwner(connection, owner);
    // normalize any shape to PublicKey list
    poolConfigs = (Array.isArray(raw) ? raw : [raw])
      .filter(Boolean)
      .map((cfg: any) => asPubkey(cfg?.pubkey ?? cfg));
  } else {
    // Fallback: allow manual override via env
    const envCfgs = parsePubkeyList(process.env.DBC_POOL_CONFIGS || null);
    if (envCfgs.lengt
