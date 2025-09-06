import { Connection, PublicKey, Transaction, ComputeBudgetProgram, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Wallet } from "@coral-xyz/anchor";
import { safeParseKeypairFromFile, parseConfigFromCli } from "../../helpers";
import { DbcConfig } from "../../utils/types";
import { DEFAULT_COMMITMENT_LEVEL } from "../../utils/constants";

/**
 * CLI:
 * pnpm studio dbc-remove-liquidity -- --pool <POOL_PUBKEY> [--amount MAX|rawUnits] [--priority microLamports]
 *
 * Examples:
 * pnpm studio dbc-remove-liquidity -- --pool 9x... --amount MAX
 * pnpm studio dbc-remove-liquidity -- --pool 9x... --amount 123456789 --priority 200000
 */

function parseArgs() {
  const argv = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) { out[k.slice(2)] = argv[i + 1] ?? ""; i++; }
  }
  return out;
}
function parsePubkey(label: string, v: string): PublicKey {
  try { return new PublicKey((v || "").trim()); }
  catch { throw new Error(`${label} is not a valid pubkey`); }
}

async function main() {
  const args = parseArgs();
  const pool = parsePubkey("pool", args.pool || "");
  const amountArg = (args.amount || "MAX").toUpperCase();
  const priority = Number(args.priority || 0);

  const config = (await parseConfigFromCli()) as DbcConfig;
  const connection = new Connection(config.rpcUrl, DEFAULT_COMMITMENT_LEVEL);

  console.log(`> Using keypair file path ${config.keypairFilePath}`);
  const keypair = await safeParseKeypairFromFile(config.keypairFilePath);
  const wallet = new Wallet(keypair);

  const client: any = new DynamicBondingCurveClient(connection as any, wallet.payer as any);

  // Resolve LP mint from pool (accommodate different SDK versions)
  let lpMint: PublicKey | null = null;
  try {
    if (typeof client.getPoolState === "function") {
      const st = await client.getPoolState(pool);
      if (st?.lpMint) lpMint = new PublicKey(st.lpMint);
    }
  } catch {}
  if (!lpMint) {
    try {
      if (typeof client.getPool === "function") {
        const acc = await client.getPool(pool);
        if (acc?.lpMint) lpMint = new PublicKey(acc.lpMint);
      }
    } catch {}
  }
  if (!lpMint) throw new Error("Could not resolve LP mint for this pool (not a Meteora DBC pool?)");

  const userLpAta = getAssociatedTokenAddressSync(lpMint, wallet.publicKey);
  const bal = await connection.getTokenAccountBalance(userLpAta).catch(() => null);
  const lpBal = bal?.value?.amount ? BigInt(bal.value.amount) : 0n;
  if (lpBal === 0n) throw new Error("Your wallet holds 0 LP for this pool.");

  const amount = amountArg === "MAX"
    ? lpBal
    : (() => { if (!/^\d+$/.test(amountArg)) throw new Error("amount must be integer raw units or MAX"); return BigInt(amountArg) })();
  if (amount > lpBal) throw new Error("amount exceeds your LP balance");

  // Optional priority fee
  const preIxs = priority > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority })] : [];

  // Prefer ix builders; fall back to high-level method across SDK versions
  let withdrawIx: any | null = null;
  if (typeof client.buildWithdrawIx === "function") {
    withdrawIx = await client.buildWithdrawIx({ pool, amount });
  } else if (typeof client.buildRemoveLiquidityIx === "function") {
    withdrawIx = await client.buildRemoveLiquidityIx({ pool, amount });
  }

  let signature: string | undefined;

  if (withdrawIx) {
    const tx = new Transaction();
    preIxs.forEach(ix => tx.add(ix));
    tx.add(withdrawIx);
    tx.feePayer = wallet.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(wallet.payer);
    signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true }); // fast path
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, DEFAULT_COMMITMENT_LEVEL);
  } else if (typeof client.withdraw === "function" || typeof client.removeLiquidity === "function") {
    const call = typeof client.withdraw === "function"
      ? () => client.withdraw({ pool, amount })
      : () => client.removeLiquidity({ pool, amount });
    const res = await call();
    if (typeof res === "string") {
      signature = res;
    } else if (res instanceof VersionedTransaction) {
      if (preIxs.length) throw new Error("Priority fee can’t be appended to SDK v0 tx; omit --priority or update SDK.");
      res.sign([wallet.payer]);
      signature = await connection.sendTransaction(res, { skipPreflight: true });
    } else if ((res as any)?.serialize) {
      preIxs.forEach(ix => (res as any).add(ix));
      (res as any).sign(wallet.payer);
      signature = await connection.sendRawTransaction((res as any).serialize(), { skipPreflight: true });
    } else {
      throw new Error("Unrecognized SDK return; upgrade @meteora-ag/dynamic-bonding-curve-sdk.");
    }
  } else {
    throw new Error("SDK version lacks withdraw helpers. Upgrade @meteora-ag/dynamic-bonding-curve-sdk.");
  }

  console.log("\n✅ Withdraw submitted");
  console.log("Signature:", signature);
  if (signature) console.log(`https://solscan.io/tx/${signature}`);
}

main().catch((e) => {
  console.error("Remove-liquidity failed:", e?.message || e);
  process.exit(1);
});
