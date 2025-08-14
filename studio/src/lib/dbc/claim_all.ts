// studio/src/lib/dbc/claim_all.ts
import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  Keypair,
} from "@solana/web3.js";

// NOTE: These imports mirror the SDK usage in your existing DBC scripts.
// If your repo re-exports helpers differently, only adjust the import paths.
import {
  getPoolConfigsByOwner,
  getPoolsByConfig,
  // Depending on SDK version, these may be under a client helper:
  // e.g. `import { DbcClient } from "@meteora-ag/dynamic-bonding-curve-sdk"`
  fetchPoolState,
  buildClaimTradingFeesIx,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

type SignerLike = {
  publicKey?: PublicKey;
  signTransaction: (tx: VersionedTransaction | any) => Promise<any>;
};

export type ClaimAllOpts = {
  priorityMicrolamportsPerCU?: number; // e.g. 1500
  maxIxsPerTx?: number;                // safety cap; 12–18 usually fine
  skipIfNoFees?: boolean;              // skip pools with zero claimable fees
  setComputeUnitLimit?: number;        // e.g. 1_000_000
};

export async function claimAllTradingFeesForOwner(
  connection: Connection,
  owner: PublicKey,        // the owner of the DBC pool configs
  feeClaimer: PublicKey,   // the wallet that receives partner fees
  signer: SignerLike,      // wallet adapter / keypair wrapper
  opts: ClaimAllOpts = {}
) {
  const {
    priorityMicrolamportsPerCU = 0,
    maxIxsPerTx = 14,
    skipIfNoFees = true,
    setComputeUnitLimit = 1_000_000,
  } = opts;

  // 1) Get all pool configs owned by `owner`
  const poolConfigs = await getPoolConfigsByOwner(connection, owner);

  // 2) Expand configs → pools
  const poolsArrays = await Promise.all(
    poolConfigs.map((cfg: any) => getPoolsByConfig(connection, cfg.pubkey))
  );
  const pools = poolsArrays.flat();

  // 3) Build one claim instruction per pool
  const claimIxs: any[] = [];
  for (const pool of pools) {
    try {
      if (skipIfNoFees) {
        const state: any = await fetchPoolState(connection, pool.pubkey);
        // Try common field names; different SDKs expose BigInt/number.
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

      const ix = await buildClaimTradingFeesIx({
        connection,
        poolPubkey: new PublicKey(pool.pubkey),
        feeClaimer,
      });

      // Some SDKs return { ix } or { instructions: [] }
      if (Array.isArray(ix)) {
        claimIxs.push(...ix);
      } else if (ix?.instructions) {
        claimIxs.push(...ix.instructions);
      } else {
        claimIxs.push(ix);
      }
    } catch (e) {
      // Non-fatal — continue building others
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

    // Use v0 message to lower TX size; falls back to legacy if needed
    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msg);

    // If signer is a Keypair, .sign will exist; otherwise expect signTransaction
    const maybeKp = (signer as unknown as Keypair);
    if (maybeKp?.secretKey) {
      vtx.sign([maybeKp]);
    } else {
      await signer.signTransaction(vtx);
    }

    const sig = await connection.sendTransaction(vtx, {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Optional: confirm each chunk
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    sigs.push(sig);
  }

  return { sent: sigs.length, sigs };
}
