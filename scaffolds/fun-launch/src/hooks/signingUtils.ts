import { VersionedTransaction } from '@solana/web3.js';

/**
 * Result of adaptive signing.
 */
export interface AdaptiveSigningResult {
  signed: VersionedTransaction[];
  usedBatch: boolean;
  errors: (string | null)[]; // per index error if single fallback encountered an issue
}

/** Wallet shape subset we care about */
interface WalletLike {
  signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  signAllTransactions?: (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;
}

/**
 * Attempt to sign many transactions at once using signAllTransactions when available.
 * Falls back to serial signTransaction if batch not supported or batch fails entirely.
 * Does NOT partially fallback mid-array (to avoid mixed trust contexts). If batch call throws,
 * we re-run serially. Individual serial failures are recorded but do not abort the whole list.
 */
export async function signTransactionsAdaptive(
  wallet: WalletLike,
  txs: VersionedTransaction[]
): Promise<AdaptiveSigningResult> {
  if (!Array.isArray(txs) || txs.length === 0) return { signed: [], usedBatch: false, errors: [] };

  // First try batch path if present.
  if (wallet.signAllTransactions) {
    try {
      const signed = await wallet.signAllTransactions(txs);
      if (Array.isArray(signed) && signed.length === txs.length) {
        return { signed, usedBatch: true, errors: new Array(txs.length).fill(null) };
      }
      // fall through to serial if unexpected shape
    } catch {
      // swallow and fallback
    }
  }
  // Serial fallback
  const result: VersionedTransaction[] = [];
  const errors: (string | null)[] = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    try {
      if (!wallet.signTransaction) throw new Error('signTransaction not supported by wallet');
      const signed = await wallet.signTransaction(tx);
      result.push(signed);
      errors.push(null);
    } catch (e: any) {
      // Push original tx unsiged placeholder so index alignment stays stable.
      result.push(tx);
      errors.push(e?.message || 'sign failed');
    }
  }
  return { signed: result, usedBatch: false, errors };
}
