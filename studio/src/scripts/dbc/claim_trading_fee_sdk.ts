// studio/src/scripts/dbc/claim_trading_fee_sdk.ts
import "dotenv/config";
import { Connection, PublicKey, SendTransactionError } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { safeParseKeypairFromFile, parseConfigFromCli } from "../../helpers";
import { DbcConfig } from "../../utils/types";
import { DEFAULT_COMMITMENT_LEVEL } from "../../utils/constants";
import { claimTradingFee } from "../../lib/dbc";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  NATIVE_MINT,
} from "@solana/spl-token";

/** Parse comma-separated base mints from env */
function parseBaseMintsFromEnv(): string[] {
  const raw = (process.env.BASE_MINTS || "").trim();
  if (!raw)
    throw new Error(
      "Missing BASE_MINTS. Provide a comma-separated list of base mint addresses."
    );
  return Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
}

/** Ensure the receiver has an ATA for a given mint (so the claim tx doesn't pay rent) */
async function ensureAta(
  connection: Connection,
  payerWallet: Wallet,
  mint: PublicKey,
  owner: PublicKey
) {
  const ata = await getAssociatedTokenAddress(mint, owner, false);
  try {
    // Anchor Wallet exposes the signer under `.payer`
    // If your Wallet type differs, swap to the raw Keypair you load from file.
    // @ts-expect-error Anchor Wallet has `.payer`
    await getOrCreateAssociatedTokenAccount(connection, payerWallet.payer, mint, owner);
    console.log(`> ATA ready for ${mint.toBase58()} → ${ata.toBase58()}`);
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/already.*initialized|exists/i.test(msg)) {
      console.log(`> ATA already exists for ${mint.toBase58()} → ${ata.toBase58()}`);
    } else {
      console.log(`> ATA check/create non-fatal for ${mint.toBase58()}: ${msg}`);
    }
  }
}

/** Pre-create ATAs for receiver for wSOL + all base mints */
async function prepReceiverAtas(
  connection: Connection,
  payerWallet: Wallet,
  receiver: PublicKey,
  baseMints: string[]
) {
  // wSOL first
  await ensureAta(connection, payerWallet, NATIVE_MINT, receiver);
  // then all the base mints
  for (const m of baseMints) {
    await ensureAta(connection, payerWallet, new PublicKey(m), receiver);
  }
}

async function main() {
  const config = (await parseConfigFromCli()) as DbcConfig;

  console.log(`> Using keypair file path ${config.keypairFilePath}`);
  const keypair = await safeParseKeypairFromFile(config.keypairFilePath);

  console.log("\n> Initializing with general configuration...");
  console.log(`- Using RPC URL ${config.rpcUrl}`);
  console.log(`- Dry run = ${config.dryRun}`);
  console.log(`- Using wallet ${keypair.publicKey} to claim trading fees`);

  const connection = new Connection(config.rpcUrl, DEFAULT_COMMITMENT_LEVEL);
  const wallet = new Wallet(keypair);

  // Helpful: fee payer balance (common root cause for your error)
  const lamports = await connection.getBalance(wallet.publicKey);
  console.log(`- Fee payer balance: ${(lamports / 1e9).toFixed(9)} SOL`);

  const baseMints = parseBaseMintsFromEnv();
  console.log(`\n> Found ${baseMints.length} base mint(s) to process`);

  // Determine the final fee receiver (where partner fees land)
  const receiverStr =
    (config as any)?.partnerFee?.receiver ||
    (config as any)?.partnerFeeReceiver ||
    "";
  if (!receiverStr) {
    console.warn(
      "⚠ No partner fee receiver found in config.partnerFee.receiver — will default to wallet public key."
    );
  }
  const receiver = receiverStr ? new PublicKey(receiverStr) : wallet.publicKey;

  // Pre-create receiver ATAs to avoid rent during claim (skip in dry run)
  if (!config.dryRun) {
    console.log("\n> Prepping receiver ATAs (wSOL + all base mints)...");
    await prepReceiverAtas(connection, wallet, receiver, baseMints);
  } else {
    console.log("\n> Dry run enabled — skipping ATA prep.");
  }

  const results: { mint: string; ok: boolean; error?: string }[] = [];

  for (const mint of baseMints) {
    const runCfg: DbcConfig = { ...config, baseMint: mint };
    console.log(`\n=== Claiming trading fee for baseMint ${mint} ===`);
    try {
      await claimTradingFee(runCfg, connection, wallet);
      results.push({ mint, ok: true });
      console.log(`✔ Success for ${mint}`);
    } catch (e: any) {
      let msg = e?.message || String(e);

      // Surface simulation logs if available
      if (e instanceof SendTransactionError && typeof e.getLogs === "function") {
        try {
          const logs = await e.getLogs(connection);
          if (logs?.length) {
            console.error("— Simulation logs —");
            for (const line of logs) console.error(line);
          } else {
            console.error("— No program logs returned by simulation —");
          }
        } catch (logErr: any) {
          console.error(
            "— Could not fetch simulation logs —",
            logErr?.message || logErr
          );
        }
      }

      // Common Solana preflight failure cause:
      if (
        /Attempt to debit an account but found no record of a prior credit/i.test(msg)
      ) {
        msg +=
          " | Hint: fee payer likely lacks SOL or the tx tried to create an ATA (rent). Pre-create ATAs and fund the fee payer.";
      }

      results.push({ mint, ok: false, error: msg });
      console.error(`✖ Failed for ${mint}: ${msg}`);
      // continue loop on failure
      continue;
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  console.log("\n> Summary:");
  console.log(`- Success: ${okCount}`);
  console.log(`- Failed:  ${failCount}`);
  if (failCount) {
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  * ${r.mint}: ${r.error}`);
    }
  }

  // Exit nonzero if any failed (so CI flags it)
  if (failCount) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
