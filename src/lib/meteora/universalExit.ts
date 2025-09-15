import { Connection, PublicKey } from "@solana/web3.js";
import { getLatestPosition, buildWithdrawAllIx } from "./dammv2";
import { planFeeClaimAuto } from "./dbc";
import { resolveDammV2Pool, recordMigrationLink } from "./migration";

export async function plan({ connection, ownerPubkey, simulateOnly = false }: { connection: Connection; ownerPubkey: PublicKey; simulateOnly?: boolean }) {
  const latestPosition = await getLatestPosition(connection, ownerPubkey);
  if (!latestPosition) {
    return { steps: [], notes: ["No DAMM v2 positions found."], estUnits: 0, skips: ["No position NFTs"] };
  }
  const pool = await resolveDammV2Pool({ baseMint: latestPosition.baseMint, quoteMint: latestPosition.quoteMint });
  const migration = recordMigrationLink({ dbcPool: latestPosition.dbcPool, dammV2Pool: pool });
  const feeClaim = await planFeeClaimAuto({ connection, pool: latestPosition.dbcPool, owner: ownerPubkey });
  const withdrawIx = buildWithdrawAllIx({ position: latestPosition, owner: ownerPubkey });
  const steps = [];
  if (feeClaim.ix) steps.push({ type: "claimFees", ix: feeClaim.ix, role: feeClaim.role });
  if (withdrawIx) steps.push({ type: "withdrawAll", ix: withdrawIx });
  return { steps, notes: [], estUnits: steps.length, skips: migration.notMigrated ? ["Pool not migrated yet."] : [] };
}

export async function execute({ connection, wallet, plan }: { connection: Connection; wallet: any; plan: any }) {
  // Compose v0 message(s), simulate, prompt wallet signature, send + confirm
  // ...implementation...
  return { status: "success", signatures: [] };
}

// Universal exit helper stub
export function universalExit() {
  return null;
}
