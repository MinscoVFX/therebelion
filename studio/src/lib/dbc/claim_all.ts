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
    if (envCfgs.length === 0) {
      throw new Error(
        "SDK does not expose getPoolConfigsByOwner; set DBC_POOL_CONFIGS with pool-config pubkeys (comma-separated) or update the DBC SDK mapping."
      );
    }
    poolConfigs = envCfgs;
  }

  // 2) Expand configs → pools (or fallback to env)
  let pools: PublicKey[] = [];
  if (getPoolsByConfig) {
    const arrays = await Promise.all(
      poolConfigs.map((cfgPk) => getPoolsByConfig(connection, cfgPk))
    );
    pools = arrays.flat().map((p: any) => asPubkey(p?.pubkey ?? p));
  } else {
    const envPools = parsePubkeyList(process.env.DBC_POOLS || null);
    if (envPools.length === 0) {
      throw new Error(
        "SDK does not expose getPoolsByConfig; set DBC_POOLS with pool pubkeys (comma-separated) or update the DBC SDK mapping."
      );
    }
    pools = envPools;
  }

  // 3) Build one claim instruction per pool (optionally skip 0-fee pools)
  const claimIxs: TransactionInstruction[] = [];
  for (const poolPk of pools) {
    try {
      if (skipIfNoFees && fetchPoolState) {
        const state: any = await fetchPoolState(connection, poolPk);
        const pending =
          state?.partnerFeesUnclaimed ??
          state?.feesUnclaimed ??
          state?.claimablePartnerFees ??
          0n;
        const isZero =
          (typeof pending === "bigint" && pending === 0n) ||
          (typeof pending === "number" && pending === 0);
        if (isZero) continue;
      }

      if (!buildClaimTradingFeesIx) {
        throw new Error("SDK does not expose buildClaimTradingFeesIx");
      }

      // Try flexible call shapes
      let ixOrGroup: any;
      try {
        ixOrGroup = await buildClaimTradingFeesIx({
          connection,
          poolPubkey: poolPk,
          feeClaimer,
        });
      } catch {
        try {
          ixOrGroup = await buildClaimTradingFeesIx(connection, {
            poolPubkey: poolPk,
            feeClaimer,
          });
        } catch {
          ixOrGroup = await buildClaimTradingFeesIx(poolPk, feeClaimer);
        }
      }

      if (Array.isArray(ixOrGroup)) {
        claimIxs.push(...(ixOrGroup as TransactionInstruction[]));
      } else if (ixOrGroup?.instructions) {
        claimIxs.push(...(ixOrGroup.instructions as TransactionInstruction[]));
      } else if (ixOrGroup) {
        claimIxs.push(ixOrGroup as TransactionInstruction);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping pool ${poolPk.toBase58?.() ?? String(poolPk)}:`, e);
    }
  }

  if (claimIxs.length === 0) {
    return { sent: 0, sigs: [], note: "No claimable fees found or no IXs built." };
  }

  // 4) Chunk into multiple transactions if needed
  const chunks: TransactionInstruction[][] = [];
  for (let i = 0; i < claimIxs.length; i += maxIxsPerTx) {
    chunks.push(claimIxs.slice(i, i + maxIxsPerTx));
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const payer = feeClaimer;

  const sigs: string[] = [];
  for (const ixChunk of chunks) {
    const ixs: TransactionInstruction[] = [];

    if (priorityMicrolamportsPerCU > 0) {
      ixs.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityMicrolamportsPerCU,
        })
      );
    }
    if (setComputeUnitLimit && setComputeUnitLimit > 0) {
      ixs.push(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: setComputeUnitLimit,
        })
      );
    }

    ixs.push(...ixChunk);

    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);

    const maybeKp = signer as unknown as Keypair;
    if ((maybeKp as any)?.secretKey) {
      vtx.sign([maybeKp]);
    } else {
      await signer.signTransaction(vtx);
    }

    const sig = await connection.sendTransaction(vtx, {
      skipPreflight: false,
      maxRetries: 3,
    });

    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    sigs.push(sig);
  }

  return { sent: sigs.length, sigs };
}
