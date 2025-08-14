// studio/src/scripts/dbc/claim_all_fees.ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { claimAllTradingFeesForOwner } from "../../lib/dbc/claim_all";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

async function main() {
  // Resolve config path deterministically (string)
  const defaultCfgPath = resolve(process.cwd(), "studio/config/dbc_config.jsonc");
  const cfgFlagIdx = process.argv.indexOf("--config");
  const argAfterFlag = cfgFlagIdx >= 0 ? process.argv[cfgFlagIdx + 1] : undefined;
  const cfgPath: string =
    typeof argAfterFlag === "string" && argAfterFlag.trim().length > 0
      ? argAfterFlag
      : defaultCfgPath;

  // Load config (JSONC-friendly)
  const stripJsonComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  const cfgText = readFileSync(cfgPath, "utf8");
  const cfg: any = JSON.parse(stripJsonComments(cfgText)) ?? {};

  const rpcUrl = cfg.rpcUrl || process.env.RPC_URL;
  if (!rpcUrl) throw new Error("Missing rpcUrl (set in dbc_config.jsonc or RPC_URL env)");

  const ownerStr = cfg.owner || process.env.DBC_OWNER;
  if (!ownerStr) throw new Error("Missing owner (set cfg.owner or DBC_OWNER env)");

  const feeClaimerStr = cfg.feeClaimer || process.env.FEE_CLAIMER;
  if (!feeClaimerStr) throw new Error("Missing feeClaimer (set cfg.feeClaimer or FEE_CLAIMER env)");

  // Load signer (no require, no helper deps)
  let signer: Keypair | null = null;
  const toKeypair = (v: unknown): Keypair | null => {
    try {
      if (Array.isArray(v)) {
        return Keypair.fromSecretKey(Uint8Array.from(v as number[]));
      }
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          const arr = JSON.parse(trimmed) as number[];
          return Keypair.fromSecretKey(Uint8Array.from(arr));
        }
      }
    } catch {}
    return null;
  };
  signer = toKeypair(cfg.privateKey);
  if (!signer) signer = toKeypair(process.env.PRIVATE_KEY);
  if (!signer) signer = toKeypair(process.env.PK);
  if (!signer) signer = toKeypair(process.env.PRIVATE_KEY_B58); // if base58, rely on CI keypair.json fallback
  if (!signer) {
    const kpPath = resolve(process.cwd(), "keypair.json");
    if (existsSync(kpPath)) {
      const raw = readFileSync(kpPath, "utf8");
      const arr = JSON.parse(raw) as number[];
      signer = Keypair.fromSecretKey(Uint8Array.from(arr));
    }
  }
  const assertSigner = (kp: Keypair | null): asserts kp is Keypair => {
    if (!kp) throw new Error("Unable to load signer keypair (no cfg.privateKey, env, or keypair.json found).");
  };
  assertSigner(signer);

  const connection = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(ownerStr);
  const feeClaimer = new PublicKey(feeClaimerStr);

  const priorityMicrolamportsPerCU =
    cfg.priorityMicrolamportsPerCU ??
    (process.env.PRIORITY_MICROLAMPORTS_PER_CU
      ? Number(process.env.PRIORITY_MICROLAMPORTS_PER_CU)
      : 0);

  const maxIxsPerTx =
    cfg.maxIxsPerTx ?? (process.env.MAX_IXS_PER_TX ? Number(process.env.MAX_IXS_PER_TX) : 14);

  const res = await claimAllTradingFeesForOwner(
    connection,
    owner,
    feeClaimer,
    {
      publicKey: signer.publicKey,
      signTransaction: async (tx: any) => {
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
