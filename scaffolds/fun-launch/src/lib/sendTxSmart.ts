// scaffolds/fun-launch/src/lib/sendTxSmart.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { sendTransactionSmart } from '@/lib/microbatchClient';

type WalletLike = {
  sendTransaction: (tx: any, connection: any, opts?: any) => Promise<string>;
  signTransaction: (tx: any) => Promise<any>;
  publicKey?: { toBase58: () => string };
};

type ConnectionLike = unknown;

/**
 * Drop-in wrapper: tries micro-batch path when NEXT_PUBLIC_MICROBATCH=1,
 * otherwise falls back to wallet.sendTransaction exactly as before.
 */
export async function sendTxSmart(
  wallet: WalletLike,
  connection: ConnectionLike,
  tx: any,
): Promise<string> {
  return sendTransactionSmart(
    connection,
    wallet,
    tx,
    // fallback preserves your current behavior 1:1
    (t: any) => wallet.sendTransaction(t, connection as any, { skipPreflight: true }),
  );
}
