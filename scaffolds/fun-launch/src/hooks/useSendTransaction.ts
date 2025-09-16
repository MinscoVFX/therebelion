import { useState } from 'react';
import { toast } from 'sonner';
import { useWallet } from '@jup-ag/wallet-adapter';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { assertOnlyAllowedUnsignedSigners } from '@/lib/txSigners';

type SendTransactionOptions = {
  onSuccess?: (signature: string) => void;
  onError?: (error: string) => void;
  additionalSigners?: Keypair[];
};

export function useSendTransaction() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const { publicKey, signTransaction } = useWallet();

  const sendTransaction = async (
    vtx: VersionedTransaction,
    connection: Connection,
    options: SendTransactionOptions = {}
  ) => {
    if (!publicKey || !signTransaction) {
      const walletError = new Error('Wallet not connected');
      setError(walletError);
      toast.error('Wallet not connected. Please connect your wallet.');
      options.onError?.(walletError.message);
      return null;
    }

    setIsLoading(true);
    setError(null);
    setSignature(null);

    try {
      // Only VersionedTransaction is supported now. Caller must provide a compiled v0 tx.
      if (!(vtx instanceof VersionedTransaction)) {
        throw new Error('sendTransaction expects a VersionedTransaction');
      }

      // Simulate transaction (no sigVerify to save CU)
      const simulation = await connection.simulateTransaction(vtx, { sigVerify: false });

      if (simulation.value.err) {
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      // Pre-flight signer sanity: ensure only wallet needs to sign now.
      try {
        assertOnlyAllowedUnsignedSigners(vtx, [publicKey]);
      } catch (e: any) {
        throw new Error(e?.message || 'Signer validation failed');
      }

      // Sign and send transaction
      const signed = await signTransaction(vtx as any); // adapter supports VersionedTransaction
      if (options.additionalSigners) {
        options.additionalSigners.forEach((signer) => {
          (signed as any).sign([signer]);
        });
      }

      const raw = signed.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction({
        signature: sig,
        blockhash: vtx.message.recentBlockhash,
        lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
      });

      setSignature(sig);
      options.onSuccess?.(sig);
      return sig;
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      setError(new Error(errorMessage));
      options.onError?.(`Transaction failed: ${errorMessage}`);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    sendTransaction,
    isLoading,
    error,
    signature,
  };
}
