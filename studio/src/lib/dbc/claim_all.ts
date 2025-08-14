// studio/src/lib/dbc/claim_all.ts
import {
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  Keypair,
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

  // 1) Get all pool configs owned by `owner`
  const getPoolConfigsByOwnerFn =
    (DBC as any).getPoolConfigsByOwner ||
    (DBC as any).DbcClient?.getPoolConfigsByOwner ||
    (DBC as any).DBCClient?.getPoolConfigsByOwner ||
    (DBC as any).PoolConfig?.getByOwner;
  if (!getPoolConfigsByOwnerFn) {
    throw new Error("SDK does not expose getPoolConfigsByOwner; please update mapping in claim_all.ts");
  }
  const poolConfigs = await getPoolConfigsByOwnerFn(connection, owner);

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
    poolConfigs.map((cfg: any) => getPoolsByConfigFn(connection, cfg.pubkey))
  );
  const pools = poolsArrays.flat();

  // 3) Build one claim instruction per pool
  const claimIxs: any[] = [];
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
        const state: any = await fetchPoolStateFn(connection, pool.pubkey);
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
        poolPubkey: new PublicKey(pool.pubkey),
        feeClaimer,
      });

      if (Array.isArray(ix)) {
        claimIxs.push(...ix);
      } else if (ix?.instructions) {
        claimIxs.push(...ix.instructions);
      } else {
        claimIxs.push(ix);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping pool ${pool?.pubkey?.toBase58?.() ?? String(pool?.pubkey)}:`,
        e
      );
    }
  }

  if (claimIxs.length === 0) {
    return { sent: 0, sigs: [], note: "No claimable fees found or no IXs built." };
  }

  // 4) Chunk into multiple transactions if needed
  const chunks: any[][] = [];
  for (let i = 0; i < claimIxs.length; i += maxIxsPerTx) {
    chunks.push(claimIxs.slice(i, i + maxIxsPerTx));
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const payer = feeClaimer;

  const sigs: string[] = [];
  for (const ixChunk of chunks) {
    const ixs = [];

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

    const maybeKp = (signer as unknown as Keypair);
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
