import type { Connection, PublicKey } from '@solana/web3.js';
import type { SendTx } from './payCreationFee';
import { payCreationFee } from './payCreationFee';

/**
 * Wrap any async action with the mandatory 0.025 SOL fee payment.
 */
export async function withCreationFee<T>(opts: {
  connection: Connection;
  wallet: PublicKey;
  sendTransaction: SendTx;
  action: () => Promise<T>;
  onPaidSignature?: (signature: string) => void;
}): Promise<T> {
  const sig = await payCreationFee({
    connection: opts.connection,
    from: opts.wallet,
    sendTransaction: opts.sendTransaction,
  });
  if (opts.onPaidSignature) opts.onPaidSignature(sig);
  return opts.action();
}
