import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

/** 0.025 SOL in lamports */
const LAMPORTS_0_025 = 25_000_000;

/**
 * Prepend a 0.025 SOL transfer (payer -> NEXT_PUBLIC_CREATION_FEE_RECEIVER)
 * to an existing unsigned transaction (base64).
 *
 * - `poolTxBase64` must be an UNSIGNED tx your backend already created.
 * - `payer` must be the wallet address that will sign/send the tx.
 *
 * Returns a NEW base64 string with the fee as the FIRST instruction.
 */
export function prependCreationFeeToBase64Tx(opts: {
  poolTxBase64: string;
  payer: string;
}): string {
  const { poolTxBase64, payer } = opts;

  const receiver = process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER;
  if (!receiver) {
    throw new Error(
      "NEXT_PUBLIC_CREATION_FEE_RECEIVER is not set. Add it to your env."
    );
  }

  const payerPk = new PublicKey(payer);
  const receiverPk = new PublicKey(receiver);

  // Decode existing tx
  const tx = Transaction.from(Buffer.from(poolTxBase64, "base64"));

  // Ensure feePayer is set to the wallet that will sign
  tx.feePayer = payerPk;

  // Prepend our transfer as the first instruction
  const transferIx = SystemProgram.transfer({
    fromPubkey: payerPk,
    toPubkey: receiverPk,
    lamports: LAMPORTS_0_025,
  });

  // Insert at index 0
  tx.instructions.unshift(transferIx);

  // Re-encode (still unsigned)
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(serialized).toString("base64");
}
