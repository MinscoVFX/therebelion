import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export type SendTx = (tx: Transaction, connection: Connection) => Promise<string>;

/** 0.025 SOL in lamports */
export const CREATION_FEE_LAMPORTS = 25_000_000;

/** Resolve and validate the fee receiver from env at runtime. */
function getFeeReceiver(): PublicKey {
  const v = process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER;
  if (!v) {
    throw new Error(
      "Creation fee receiver not configured. Set NEXT_PUBLIC_CREATION_FEE_RECEIVER to a base58 address."
    );
  }
  return new PublicKey(v);
}

/**
 * Sends a 0.025 SOL transfer from the user's wallet to your fee receiver.
 * Uses wallet-adapter's `sendTransaction`.
 */
export async function payCreationFee(opts: {
  connection: Connection;
  from: PublicKey;
  sendTransaction: SendTx;
}): Promise<string> {
  const to = getFeeReceiver();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: opts.from,
      toPubkey: to,
      lamports: CREATION_FEE_LAMPORTS,
    })
  );
  tx.feePayer = opts.from;
  const { blockhash } = await opts.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  return opts.sendTransaction(tx, opts.connection);
}
