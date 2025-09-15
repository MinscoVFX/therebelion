import { Connection, PublicKey } from "@solana/web3.js";
import { CpAmmClient } from "@meteora-ag/cp-amm-sdk";

export async function enumeratePositionNFTs(connection: Connection, owner: PublicKey) {
  // Use SDK to enumerate all Position NFTs for owner
  const client = new CpAmmClient(connection);
  return client.getUserPositions(owner);
}

export async function getLatestPosition(connection: Connection, owner: PublicKey) {
  const positions = await enumeratePositionNFTs(connection, owner);
  if (!positions.length) return null;
  // Sort by recent activity
  positions.sort((a, b) => b.lastActivity - a.lastActivity);
  return positions[0];
}

export function buildWithdrawAllIx({ position, owner }: { position: any; owner: PublicKey }) {
  // Build withdraw-all instruction(s) for the position
  // ...implementation using SDK...
  return position.withdrawAllIx(owner);
}

// DAMM v2 helper stub
export function getDammState() {
  return null;
}

export function claimDammFees() {
  return null;
}
