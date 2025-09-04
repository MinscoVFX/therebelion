import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

type FeeSplit = { receiver: PublicKey; lamports: number };
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Helpers */
function sanitize(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\u200B/g, "");
}
function parsePubkey(label: string, value: string): PublicKey {
  const v = sanitize(value);
  try { return new PublicKey(v); } catch { throw new Error(`${label} is not a valid base58 pubkey: "${v}"`); }
}

/** Parse fee splits from env:
 * - NEXT_PUBLIC_CREATION_FEE_RECEIVERS="Wallet1:0.020,Wallet2:0.015"
 * - or NEXT_PUBLIC_CREATION_FEE_RECEIVER="Wallet" (defaults to 0.035 SOL)
 */
function getFeeSplitsFromEnv(): FeeSplit[] {
  const rawMulti = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVERS);
  const rawSingle = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER);

  if (rawMulti) {
    return rawMulti
      .split(",")
      .map((s) => sanitize(s))
      .filter(Boolean)
      .map((pair) => {
        const [addrRaw, solRaw] = pair.split(":");
        const addr = sanitize(addrRaw);
        const solStr = sanitize(solRaw);
        if (!addr || !solStr) throw new Error(`Invalid fee split format: "${pair}". Use "Wallet:0.020"`);
        const receiver = parsePubkey("Fee receiver", addr);
        const sol = parseFloat(solStr);
        if (!Number.isFinite(sol) || sol <= 0) throw new Error(`Invalid SOL amount in split "${pair}"`);
        return { receiver, lamports: Math.floor(sol * LAMPORTS_PER_SOL) };
      });
  }

  if (rawSingle) {
    return [{ receiver: parsePubkey("NEXT_PUBLIC_CREATION_FEE_RECEIVER", rawSingle), lamports: 35_000_000 }];
  }

  throw new Error(
    'Missing fee receivers. Set NEXT_PUBLIC_CREATION_FEE_RECEIVERS="Wallet:0.020,Wallet:0.015" or NEXT_PUBLIC_CREATION_FEE_RECEIVER="Wallet"'
  );
}

/**
 * Prepend creation-fee transfer(s) (payer -> receiver(s)) to an unsigned tx (base64).
 *
 * - `poolTxBase64` must be an UNSIGNED tx your backend already created.
 * - `payer` must be the wallet address that will sign/send the tx.
 *
 * Returns a NEW base64 string with the fee transfer(s) as the FIRST instruction(s).
 */
export function prependCreationFeeToBase64Tx(opts: {
  poolTxBase64: string;
  payer: string;
}): string {
  const { poolTxBase64, payer } = opts;

  const base64 = sanitize(poolTxBase64);
  if (!base64) throw new Error("poolTxBase64 is empty");

  const payerPk = parsePubkey("payer", payer);
  const splits = getFeeSplitsFromEnv();

  // Decode existing tx (surface a clean error if base64 is malformed)
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(base64, "base64"));
  } catch {
    throw new Error("poolTxBase64 is not a valid base64-encoded transaction");
  }

  // Ensure feePayer is set to the wallet that will sign
  tx.feePayer = payerPk;

  // Build transfers in the exact env order and put them at the very front
  const transferIxs = splits.map((s) =>
    SystemProgram.transfer({
      fromPubkey: payerPk,
      toPubkey: s.receiver,
      lamports: s.lamports,
    })
  );

  tx.instructions = [...transferIxs, ...tx.instructions];

  // Re-encode (still unsigned)
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(serialized).toString("base64");
}
