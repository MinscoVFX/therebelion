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

  // -- helpers --------------------------------------------------------------
  const asPubkey = (v: any): PublicKey => {
    if (v instanceof PublicKey) return v;
    if (v?.toBase58) {
      try {
        return new PublicKey(v.toBase58());
      } catch {
        /* noop */
      }
    }
    if (typeof v === "string") return new PublicKey(v);
    if (v?.pubkey) return asPubkey(v.pubkey);
    if (v?.publicKey) return asPubkey(v.publicKey);
    return new PublicKey(v); // will throw if invalid (surface early)
  };

  // 1) Get all pool configs owned by `owner`
  const getPoolConfigsByOwnerFn =
    (DBC as any).getPoolConfigsByOwner ||
    (DBC as any).DbcClient?.getPoolConfigsByOwner ||
    (DBC as any).DBCClient?.getPoolConfigsByOwner ||
    (DBC as any).PoolConfig?.getByOwner;
  if (!getPoolConfigsByOwnerFn) {
    throw new Error("SDK does not expose getPoolConfigsByOwner; please update mapping in claim_all.ts");
  }
  const poolConfigs: any[] = await getPoolConfigsByOwnerFn(connection, owner);

  // 2) Expand configs → pools
  const getPoolsByConfigFn =
    (DBC as any).getPoolsByConfig ||
    (DBC as any).DbcClient?.getPoolsByConfig ||
    (DBC as any).DBCClient?.getPoolsByConfig ||
    (DBC as any).Pool?.getByConfig;
  if (!getPoolsByConfigFn) {
    throw new Error("SDK does not expose getPoolsByConfig; please update mapping in claim_all.ts");
  }
  const poolsArrays = await Promise.all(
    poolConfigs.map((cfg: any) => getPoolsByConfigFn(connection, asPubkey(cfg?.pubkey ?? cfg)))
  );
  const pools: any[] = poolsArrays.flat();

  // 3) Build one claim instruction per pool
  const claimIxs: TransactionInstruction[] = [];
  for (const pool of pools) {
    try {
      if (skipIfNoFees) {
        const fetchPoolStateFn =
          (DBC as any).fetchPoolState ||
          (DBC as any).DbcClient?.fetchPoolState ||
          (DBC as any).Pool?.fetchState;
        if (!fetchPoolStateFn) {
          throw new Error("SDK does not expose fetchPoolState; please update mapping in claim_all.ts");
        }
        const state: any = await fetchPoolStateFn(connection, asPubkey(pool?.pubkey ?? pool));
        const pending =
          state?.partnerFeesUnclaimed ??
          state?.feesUnclaimed ??
          state?.claimablePartnerFees ??
          0n;

        if (
          (typeof pending === "bigint" && pending === 0n) ||
          (typeof pending === "number" && pending === 0)
        ) {
          continue;
        }
      }

      const buildClaimTradingFeesIxFn =
        (DBC as any).buildClaimTradingFeesIx ||
        (DBC as any).DbcClient?.buildClaimTradingFeesIx ||
        (DBC as any).Pool?.buildClaimTradingFeesIx;
      if (!buildClaimTradingFeesIxFn) {
        throw new Error("SDK does not expose buildClaimTradingFeesIx; please update mapping in claim_all.ts");
      }
      const ix = await buildClaimTradingFeesIxFn({
        connection,
        poolPubkey: asPubkey(pool?.pubkey ?? pool),
        feeClaimer,
      });

      if (Array.isArray(ix)) {
        claimIxs.push(...(ix as TransactionInstruction[]));
      } else if (ix?.instructions) {
        claimIxs.push(...(ix.instructions as TransactionInstruction[]));
      } else {
        claimIxs.push(ix as TransactionInstruction);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping pool ${pool?.pubkey?.toBase58?.() ?? pool?.toBase58?.() ?? String(pool?.pubkey ?? pool)}:`,
        e
      );
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
