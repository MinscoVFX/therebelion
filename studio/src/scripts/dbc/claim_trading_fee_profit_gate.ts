// studio/src/scripts/dbc/claim_trading_fee_profit_gate.ts
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";

/**
 * TODO — wire these to YOUR actual claim-discovery + ix-builder.
 * Expected to return an array of { label, ixs, lookupTables? } where `ixs` claims
 * partner/trading fees to the payer/receiver.
 */
type BuiltClaim = { label: string; ixs: any[]; lookupTables?: AddressLookupTableAccount[] };

// --- BEGIN PLACEHOLDER WIRES ---
// If you already have utilities used by claim_trading_fee_sdk.ts to construct claim instructions,
// import and reuse them here. Example:
//
//   import { discoverClaimables, buildClaimIxs } from "./sdk_utils";
//
// Then swap `buildClaimIxsForBaseMints` to call them with the same arguments.
async function buildClaimIxsForBaseMints(
  _connection: Connection,
  baseMints: PublicKey[],
  _programId?: PublicKey
): Promise<BuiltClaim[]> {
  // Throw to force you to connect your actual builder once.
  throw new Error(
    "Wire your Meteora DBC claim ix builder here. Return {label, ixs, lookupTables?} for each claim tx."
  );
}
// --- END PLACEHOLDER WIRES ---

function getKeypair(): Keypair {
  // Prefer keypair.json if present (created by workflow step), else fall back to env b58.
  const kpPath = path.resolve(process.cwd(), "keypair.json");
  if (fs.existsSync(kpPath)) {
    const arr = JSON.parse(fs.readFileSync(kpPath, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  const s = (process.env.PK_B58 || process.env.PRIVATE_KEY_B58 || "").trim();
  if (!s) throw new Error("Missing keypair.json and PK_B58/PRIVATE_KEY_B58.");
  const dec = bs58.decode(s);
  return Keypair.fromSecretKey(dec.length === 32 ? dec : dec.slice(0, 64));
}

function parseCsv(s?: string | null): string[] {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function estimateBaseFeeLamports(connection: Connection, msg: any): Promise<number> {
  try {
    const fee = await connection.getFeeForMessage(msg);
    if (typeof fee === "number") return fee;
    if (fee && typeof (fee as any).value === "number") return (fee as any).value;
    return 5000;
  } catch {
    return 5000;
  }
}

function priorityFeeLamports(cuLimit: number, cuPriceMicroLamports: number): number {
  // microLamports per CU * CU / 1_000_000
  return Math.floor((cuLimit * cuPriceMicroLamports) / 1_000_000);
}

type CheckResult = {
  txCount: number;
  inflowLamports: number;
  totalBaseFeeLamports: number;
  totalPriorityLamports: number;
  totalFeesLamports: number;
  netLamports: number;
  netSol: number;
  minProfitSol: number;
  shouldClaim: boolean;
};

// Conservative: native SOL delta only. Extend this to parse SPL/WSOL balance changes if needed.
async function solInflowFromSim(
  _sim: Awaited<ReturnType<Connection["simulateTransaction"]>>,
  _receiver: PublicKey
): Promise<number> {
  // Most RPCs don't expose a stable mapping to receiver index in simulation meta.
  // Return 0 to avoid false positives; change this when you unwrap WSOL to SOL in the claim ixs.
  return 0;
}

async function main() {
  const mode = process.argv[2]; // "check" (json output) or "claim" (not used by workflow; claim handled by your SDK script)
  if (mode !== "check" && mode !== "claim") {
    console.error("First arg must be 'check' or 'claim'");
    process.exit(2);
  }

  const rpc = arg("rpc") || process.env.RPC_URL;
  if (!rpc) throw new Error("--rpc or RPC_URL is required");
  const connection = new Connection(rpc, { commitment: "confirmed" });

  const baseMints = parseCsv(arg("base-mints") || process.env.BASE_MINTS).map((s) => new PublicKey(s));
  const programId = (arg("program-id") || process.env.DBC_PROGRAM_ID)
    ? new PublicKey(arg("program-id") || (process.env.DBC_PROGRAM_ID as string))
    : undefined;

  const cuLimit = Number(arg("cu-limit") || process.env.CU_LIMIT || "300000");
  const cuPrice = Number(arg("cu-price") || process.env.CU_PRICE_MICROLAMPORTS || "2000");
  const minProfitSol = Number(arg("min-profit-sol") || process.env.MIN_PROFIT_SOL || "0");

  const payer = getKeypair();

  const built = await buildClaimIxsForBaseMints(connection, baseMints, programId);
  if (!built.length) {
    const empty: CheckResult = {
      txCount: 0,
      inflowLamports: 0,
      totalBaseFeeLamports: 0,
      totalPriorityLamports: 0,
      totalFeesLamports: 0,
      netLamports: 0,
      netSol: 0,
      minProfitSol,
      shouldClaim: false,
    };
    if (hasFlag("json")) console.log(JSON.stringify(empty, null, 2));
    else console.log("[check] No claimable txs found.");
    return;
  }

  let inflow = 0;
  let baseFees = 0;
  let prioFees = 0;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  for (const one of built) {
    const ix = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }),
      ...one.ixs,
    ];
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: ix,
    }).compileToV0Message(one.lookupTables ?? []);
    baseFees += await estimateBaseFeeLamports(connection, msg);
    prioFees += priorityFeeLamports(cuLimit, cuPrice);

    const vtx = new VersionedTransaction(msg);
    vtx.sign([payer]);
    const sim = await connection.simulateTransaction(vtx, {
      replaceRecentBlockhash: true,
      sigVerify: false,
      commitment: "processed",
    });

    // NOTE: inflow is 0 unless your claim credits native SOL to payer/receiver.
    inflow += await solInflowFromSim(sim, payer.publicKey);
  }

  const totalFees = baseFees + prioFees;
  const netLamports = inflow - totalFees;
  const res: CheckResult = {
    txCount: built.length,
    inflowLamports: inflow,
    totalBaseFeeLamports: baseFees,
    totalPriorityLamports: prioFees,
    totalFeesLamports: totalFees,
    netLamports,
    netSol: netLamports / LAMPORTS_PER_SOL,
    minProfitSol,
    shouldClaim: netLamports / LAMPORTS_PER_SOL > minProfitSol,
  };

  if (mode === "check") {
    if (hasFlag("json")) console.log(JSON.stringify(res, null, 2));
    else console.log(`[check] tx=${res.txCount} net=${res.netSol.toFixed(9)} SOL min=${minProfitSol}`);
    return;
  }

  // mode === "claim" not used here; actual claim is handled by your SDK script when profitable.
  if (!res.shouldClaim) {
    console.log(`[claim] Not profitable. net=${res.netSol.toFixed(9)} SOL (min=${minProfitSol}) — skipping.`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
