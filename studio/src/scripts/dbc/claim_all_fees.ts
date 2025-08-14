// studio/src/scripts/dbc/claim_all_fees.ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { claimAllTradingFeesForOwner } from "../../lib/dbc/claim_all";

// Re-use your existing helpers so config + key handling stays identical
import { loadDbcConfig } from "../../helpers/config";
import { getKeypairFromSecretKey } from "../../helpers/accounts";

async function main() {
  // Allow `--config ./studio/config/dbc_config.jsonc` exactly like other scripts
  const cfgFlagIdx = process.argv.indexOf("--config");
  const cfgPath =
    cfgFlagIdx !== -1 && process.argv[cfgFlagIdx + 1]
      ? process.argv[cfgFlagIdx + 1]
      : "./studio/config/dbc_config.jsonc";

  const cfg: any = await loadDbcConfig(cfgPath);

  // Prefer explicit RPC in config, else env var (keeps parity with your workflow)
  const rpcUrl = cfg.rpcUrl || process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("Missing rpcUrl (set in dbc_config.jsonc or RPC_URL env)");
  }

  // The owner of pool CONFIGS (not creator), used by getPoolConfigsByOwner
  const ownerStr = cfg.owner || process.env.DBC_OWNER;
  if (!ownerStr) {
    throw new Error("Missing owner (set cfg.owner or DBC_OWNER env)");
  }

  const feeClaimerStr = cfg.feeClaimer || process.env.FEE_CLAIMER;
  if (!feeClaimerStr) {
    throw new Error("Missing feeClaimer (set cfg.feeClaimer or FEE_CLAIMER env)");
  }

  // Signer: same pattern as other studio scripts
  // Accept: cfg.privateKey (array/base58) or PRIVATE_KEY_B58 env (decoded in workflow)
  let signer: Keypair | null = null;

  if (cfg.privateKey) {
    signer = await getKeypairFromSecretKey(cfg.privateKey);
  } else if (process.env.PRIVATE_KEY || process.env.PK || process.env.PRIVATE_KEY_B58) {
    signer = await getKeypairFromSecretKey(
      process.env.PRIVATE_KEY || process.env.PK || process.env.PRIVATE_KEY_B58
    );
  } else {
    // Fallback to the keypair.json generated in CI step
    // (workflow writes keypair.json from base58 and cleans it up at the end)
    signer = await getKeypairFromSecretKey(require("../../../../keypair.json"));
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(ownerStr);
  const feeClaimer = new PublicKey(feeClaimerStr);

  const priorityMicrolamportsPerCU =
    cfg.priorityMicrolamportsPerCU ??
    (process.env.PRIORITY_MICROLAMPORTS_PER_CU
      ? Number(process.env.PRIORITY_MICROLAMPORTS_PER_CU)
      : 0);

  const maxIxsPerTx =
    cfg.maxIxsPerTx ??
    (process.env.MAX_IXS_PER_TX ? Number(process.env.MAX_IXS_PER_TX) : 14);

  const res = await claimAllTradingFeesForOwner(
    connection,
    owner,
    feeClaimer,
    {
      // Provide a signer interface the helper understands
      publicKey: signer.publicKey,
      signTransaction: async (tx: any) => {
        // VersionedTransaction has .sign, but we standardize via partialSign
        tx.sign ? tx.sign([signer as Keypair]) : tx.partialSign?.(signer as Keypair);
        return tx;
      },
    },
    {
      priorityMicrolamportsPerCU,
      maxIxsPerTx,
      skipIfNoFees: true,
      setComputeUnitLimit: 1_000_000,
    }
  );

  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
