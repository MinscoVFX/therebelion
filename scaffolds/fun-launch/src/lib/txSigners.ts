import { VersionedTransaction, PublicKey } from '@solana/web3.js';

/**
 * Inspect a VersionedTransaction and return the set of required signer pubkeys (in order).
 * The first `numRequiredSignatures` account keys in the message header are signers.
 */
export function getRequiredSignerPubkeys(vtx: VersionedTransaction): PublicKey[] {
  const message = vtx.message;
  const n = message.header.numRequiredSignatures;
  return message.staticAccountKeys.slice(0, n);
}

/**
 * Determine which required signers still lack a signature.
 */
export function getUnsignedRequiredSigners(vtx: VersionedTransaction): PublicKey[] {
  const required = getRequiredSignerPubkeys(vtx);
  // signatures array length matches numRequiredSignatures; a null/empty signature indicates unsigned
  return required.filter((_, i) => !vtx.signatures[i] || vtx.signatures[i].length === 0);
}

/**
 * Assert that all remaining unsigned required signers are included in allowed set (usually just the wallet).
 * Throws with a descriptive error listing unexpected signers to prevent opaque wallet adapter "unknown signer" errors.
 */
export function assertOnlyAllowedUnsignedSigners(
  vtx: VersionedTransaction,
  allowed: PublicKey[]
): void {
  const allowSet = new Set(allowed.map((k) => k.toBase58()));
  const unsigned = getUnsignedRequiredSigners(vtx);
  const unexpected = unsigned.filter((k) => !allowSet.has(k.toBase58()));
  if (unexpected.length > 0) {
    const listed = unexpected.map((k) => k.toBase58()).join(', ');
    throw new Error(
      `Unknown / disallowed unsigned signer(s) remaining in tx: ${listed}. This usually means a local Keypair (e.g. mint) was not partial-signed before requesting the wallet signature.`
    );
  }
}

/**
 * Validate an array of VersionedTransactions. Stops at first failure unless `continueOnError` is true.
 * Returns an array of error messages (null where validation passed) if continueOnError specified.
 */
export function validateBatchSignerSets(
  txs: VersionedTransaction[],
  allowed: PublicKey[],
  opts?: { continueOnError?: boolean }
): (string | null)[] | void {
  const errors: (string | null)[] = [];
  for (const tx of txs) {
    try {
      assertOnlyAllowedUnsignedSigners(tx, allowed);
      errors.push(null);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (!opts?.continueOnError) {
        throw new Error(msg);
      }
      errors.push(msg);
    }
  }
  if (opts?.continueOnError) return errors;
}
