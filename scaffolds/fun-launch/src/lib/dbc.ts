import crypto from 'crypto';

/**
 * Strictly resolve the claim discriminator in this order:
 * 1. If DBC_CLAIM_FEE_DISCRIMINATOR is set and is 16 hex chars, use it
 * 2. Else, if DBC_CLAIM_FEE_INSTRUCTION_NAME is set, compute sha256('global::'+name).slice(0,8)
 * 3. Else, fallback to IDL-based resolution
 */
export function resolveClaimDiscriminatorStrict(): Buffer {
  // Check for explicit discriminator environment variable
  const explicitDiscriminator = process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
  if (explicitDiscriminator && /^[0-9a-fA-F]{16}$/.test(explicitDiscriminator)) {
    return Buffer.from(explicitDiscriminator, 'hex');
  }

  // Check for instruction name to compute discriminator
  const instructionName = process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME;
  if (instructionName) {
    const hash = crypto.createHash('sha256');
    hash.update(`global::${instructionName}`);
    return hash.digest().slice(0, 8);
  }

  // Fallback to IDL-based resolution
  // This is a placeholder - in real implementation, this would use the IDL
  // For now, we'll use a default discriminator for claim trading fee
  const hash = crypto.createHash('sha256');
  hash.update('global::claim_trading_fee');
  return hash.digest().slice(0, 8);
}