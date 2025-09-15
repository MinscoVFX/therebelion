import { Connection, PublicKey } from "@solana/web3.js";
import { getDbcProgram } from "../anchor/programs";
import { dbcSelector } from "../../env/required";

// Fetch DBC pool config/state
export async function fetchDbcPoolAndConfig(connection: Connection, poolOrMint: PublicKey): Promise<any> {
  const dbcProgram = getDbcProgram(connection);
  if (!dbcProgram.account?.pool) throw new Error("DBC program account.pool not found");
  return await dbcProgram.account.pool.fetch(poolOrMint);
}

// Check if pool has claimable fees for creator/partner
export async function getClaimableFees(connection: Connection, pool: PublicKey): Promise<{ creator: boolean; partner: boolean }> {
  const dbcProgram = getDbcProgram(connection);
  if (!dbcProgram.account?.pool) throw new Error("DBC program account.pool not found");
  const poolState = await dbcProgram.account.pool.fetch(pool);
  return {
    creator: !!poolState.creatorClaimable,
    partner: !!poolState.partnerClaimable,
  };
}

// Build claim instruction by NAME or discriminator
export async function buildClaimIx(connection: Connection, role: "creator" | "partner", accounts: any) {
  const dbcProgram = getDbcProgram(connection);
  if (!dbcProgram.methods) throw new Error("DBC program methods not found");
  if (dbcSelector.mode === "name") {
    if (role === "creator") {
      if (!dbcProgram.methods.claimCreatorTradingFee) throw new Error("claimCreatorTradingFee method not found");
      return await dbcProgram.methods.claimCreatorTradingFee().accounts(accounts).instruction();
    } else {
      if (!dbcProgram.methods.claimPartnerTradingFee) throw new Error("claimPartnerTradingFee method not found");
      return await dbcProgram.methods.claimPartnerTradingFee().accounts(accounts).instruction();
    }
  }
  if (dbcSelector.mode === "disc") {
    throw new Error("Discriminator mode not implemented yet");
  }
  if (!dbcProgram.methods.claimCreatorTradingFee) throw new Error("claimCreatorTradingFee method not found");
  return await dbcProgram.methods.claimCreatorTradingFee().accounts(accounts).instruction();
}

// Plan fee claim step (auto role)
export async function planFeeClaim(connection: Connection, pool: PublicKey, accounts: any) {
  const claimable = await getClaimableFees(connection, pool);
  const dbcProgram = getDbcProgram(connection);
  if (!dbcProgram.methods) throw new Error("DBC program methods not found");
  if (dbcSelector.mode === "auto") {
    if (claimable.creator) {
      if (!dbcProgram.methods.claimCreatorTradingFee) throw new Error("claimCreatorTradingFee method not found");
      return { ix: await dbcProgram.methods.claimCreatorTradingFee().accounts(accounts).instruction(), role: "creator" };
    }
    if (claimable.partner) {
      if (!dbcProgram.methods.claimPartnerTradingFee) throw new Error("claimPartnerTradingFee method not found");
      return { ix: await dbcProgram.methods.claimPartnerTradingFee().accounts(accounts).instruction(), role: "partner" };
    }
    return { ix: null, role: undefined, reason: "No claimable fees for creator or partner" };
  }
  if (dbcSelector.mode === "name") {
    const roleKey = dbcSelector.value === "claim_creator_trading_fee" ? "creator" : "partner";
    if (claimable[roleKey]) {
      return { ix: await buildClaimIx(connection, roleKey as any, accounts), role: roleKey };
    }
    // Try other role once
    const otherRole = roleKey === "creator" ? "partner" : "creator";
    if (claimable[otherRole]) {
      return { ix: await buildClaimIx(connection, otherRole as any, accounts), role: otherRole };
    }
    return { ix: null, role: undefined, reason: "No claimable fees for selected role" };
  }
  // Discriminator mode not implemented
  return { ix: null, role: undefined, reason: "Discriminator mode not implemented" };
}

// DBC helper stub
export function getDbcState() {
  return null;
}

export function claimDbcFees() {
  return null;
}
