import type { Connection, PublicKey } from "@solana/web3.js";
import type { SendTx } from "./payCreationFee";
import { payCreationFee } from "./payCreationFee";

/**
 * Wraps your pool creation with a mandatory 0.025 SOL fee payment.
 * Usage:
 *   await withCreationFee({
 *     connection,
 *     wallet: publicKey,
 *     sendTransaction,
 *     action: () => createDbcPool(...),
 *   });
 */
export async function withCreationFee<T>(opts: {
  connection: Connection;
  wallet: PublicKey;
  sendTransaction: SendTx;
  action: () => Promise<T>;
  onPaidSignature?: (signature: string) => void;
}): Promise<T> {
  // 1) Collect the creation fee (0.025 SOL)
  const sig = await payCreationFee({
    connection: opts.connection,
    from: opts.wallet,
    sendTransaction: opts.sendTransaction,
  });
  if (opts.onPaidSignature) opts.onPaidSignature(sig);

  // 2) Run the actual creation logic
  return opts.action();
}
