// studio/src/scripts/dbc/claim_all_fees_auto.ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { claimAllTradingFeesForOwner } from "../../lib/dbc/claim_all";
import * as fs from "fs";
import { resolve } from "path";

async function main() {
  const { RPC_URL, DBC_OWNER, FEE_CLAIMER } = process.env;
  if (!RPC_URL || !DBC_OWNER || !FEE_CLAIMER) {
    throw new Error("Missing RPC_URL, DBC_OWNER, or FEE_CLAIMER in env vars");
  }

  // Use the keypair.json created by the workflow decode step
  const kpPath = resolve(process.cwd(), "keypair.json");
  if (!fs.existsSync(kpPath)) {
    throw new Error(`keypair.json not found at ${kpPath}`);
  }
  const arr = JSON.parse(fs.readFileSync(kpPath, "utf8")) as number[];
  const kp = Keypair.fromSecretKey(Uint8Array.from(arr));

  const connection = new Connection(RPC_URL, "confirmed");
  const owner = new PublicKey(DBC_OWNER);
  const feeClaimer = new PublicKey(FEE_CLAIMER);

  // Wrap Keypair to match the signer shape expected by claimAllTradingFeesForOwner
  const signer: { publicKey: PublicKey; signTransaction: (tx: any) => Promise<any> } = {
    publicKey: kp.publicKey,
    signTransaction: async (tx: any) => {
      tx.sign ? tx.sign([kp]) : tx.partialSign?.(kp);
      return tx;
    },
  };

  const res = await claimAllTradingFeesForOwner(connection, owner, feeClaimer, signer, {
    skipIfNoFees: true,
    priorityMicrolamportsPerCU: 1500,
    maxIxsPerTx: 14,
    setComputeUnitLimit: 1_000_000,
  });

  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
