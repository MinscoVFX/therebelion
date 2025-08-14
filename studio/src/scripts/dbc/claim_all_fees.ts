// studio/src/scripts/dbc/claim_all_fees.ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { claimAllTradingFeesForOwner } from "../../lib/dbc/claim_all";
import * as ConfigHelpers from "../../helpers/config";
import * as AccountHelpers from "../../helpers/accounts";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

async function main() {
  const defaultCfgPath = resolve(process.cwd(), "studio/config/dbc_config.jsonc");
  const cfgFlagIdx = process.argv.indexOf("--config");
  const argAfterFlag = cfgFlagIdx >= 0 ? process.argv[cfgFlagIdx + 1] : undefined;
  const cfgPath: string =
    typeof argAfterFlag === "string" && argAfterFlag.trim().length > 0
      ? argAfterFlag
      : defaultCfgPath;

  const loadCfg =
    (ConfigHelpers as any).loadDbcConfig ||
    (ConfigHelpers as any).loadConfig ||
    (ConfigHelpers as any).getDbcConfig;
  const stripJsonComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  const cfgRaw = loadCfg
    ? await loadCfg(cfgPath)
    : JSON.parse(stripJsonComments(readFileSync(cfgPath, "utf8")));
  const cfg: any = cfgRaw ?? {};

  const rpcUrl = cfg.rpcUrl || process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("Missing rpcUrl (set in dbc_config.jsonc or RPC_URL env)");
  }

  const ownerStr = cfg.owner || process.env.DBC_OWNER;
  if (!ownerStr) {
    throw new Error("Missing owner (set cfg.owner or DBC_OWNER env)");
  }

  const feeClaimerStr = cfg.feeClaimer || process.env.FEE_CLAIMER;
  if (!feeClaimerStr) {
    throw new Error("Missing feeClaimer (set cfg.feeClaimer or FEE_CLAIMER env)");
  }

  let signer: Keypair | null = null;
  const getKp =
    (AccountHelpers as any).getKeypairFromSecretKey ||
    (AccountHelpers as any).keypairFromSecret ||
    (AccountHelpers as any).loadKeypairFromSecret;
  if (cfg.privateKey && getKp) {
    signer = await getKp(cfg.privateKey);
  } else if ((process.env.PRIVATE_KEY || process.env.PK || process.env.PRIVATE_KEY_B58) && getKp) {
    signer = await getKp(process.env.PRIVATE_KEY || process.env.PK || process.env.PRIVATE_KEY_B58);
  } else {
    const kpPath = resolve(process.cwd(), "keypair.json");
    if (existsSync(kpPath)) {
      const raw = readFileSync(kpPath, "utf8");
      const arr = JSON.parse(raw) as number[];
      signer = Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  }
  if (!signer) {
    throw new Error("Unable to load signer keypair (no cfg.privateKey, env, or keypair.json found).");
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
      publicKey: signer.publicKey,
      signTransaction: async (tx: any) => {
        (tx.sign ? tx.sign([signer as Keypair]) : tx.partialSign?.(signer as Keypair));
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
