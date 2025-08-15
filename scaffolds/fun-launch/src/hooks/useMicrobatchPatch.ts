// scaffolds/fun-launch/src/hooks/useMicrobatchPatch.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react';
import { sendTxSmart } from '@/lib/sendTxSmart';

type WalletLike = {
  sendTransaction?: (tx: any, connection: any, opts?: any) => Promise<string>;
  signTransaction?: (tx: any) => Promise<any>;
  publicKey?: { toBase58: () => string };
};

export function useMicrobatchPatch(wallet: WalletLike | null | undefined, connection: any) {
  const patchedRef = useRef(false);

  useEffect(() => {
    if (patchedRef.current) return;
    if (!wallet || !wallet.sendTransaction || !wallet.signTransaction) return;
    if (process.env.NEXT_PUBLIC_MICROBATCH !== '1') return; // only patch when enabled

    const original = wallet.sendTransaction!.bind(wallet);

    wallet.sendTransaction = async (tx: any, conn: any, opts?: any) => {
      try {
        // Route through our smart sender (uses API + falls back to original on error)
        return await sendTxSmart(
          wallet as any,
          connection ?? conn,
          tx
        );
      } catch {
        // fallback to original path
        return original(tx, conn, opts);
      }
    };

    patchedRef.current = true;
  }, [wallet, connection]);
}
