import { PublicKey, Connection } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export function formatNumber(num: number, decimals: number = 2): string {
  if (num === 0) return '0';
  if (num < 0.01) return '<0.01';
  if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
  return num.toFixed(decimals);
}

export function formatTokenAmount(
  amount: BN,
  decimals: number,
  displayDecimals: number = 6
): string {
  const divisor = new BN(10).pow(new BN(decimals));
  const whole = amount.div(divisor);
  const fraction = amount.mod(divisor);

  if (fraction.isZero()) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(decimals, '0');
  const trimmed = fractionStr.replace(/0+$/, '');
  const limited = trimmed.slice(0, displayDecimals);

  return limited ? `${whole.toString()}.${limited}` : whole.toString();
}

export function parseTokenAmount(amount: string, decimals: number): BN {
  const [whole, fraction = ''] = amount.split('.');
  const wholeBN = new BN(whole || '0');
  const fractionBN = new BN(fraction.padEnd(decimals, '0').slice(0, decimals));
  const divisor = new BN(10).pow(new BN(decimals));

  return wholeBN.mul(divisor).add(fractionBN);
}

export function isValidPublicKey(key: string): boolean {
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
}

export function shortenAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function confirmTransaction(
  connection: Connection,
  signature: string,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
): Promise<boolean> {
  try {
    const confirmation = await connection.confirmTransaction(signature, commitment);
    return !confirmation.value.err;
  } catch (error) {
    console.error('Error confirming transaction:', error);
    return false;
  }
}

export function calculatePriceImpact(
  inputAmount: BN,
  outputAmount: BN,
  inputReserve: BN,
  outputReserve: BN
): number {
  if (inputReserve.isZero() || outputReserve.isZero()) return 0;

  const spotPrice = outputReserve.mul(new BN(1e6)).div(inputReserve);
  const effectivePrice = outputAmount.mul(new BN(1e6)).div(inputAmount);
  const impact = spotPrice.sub(effectivePrice).mul(new BN(10000)).div(spotPrice);

  return impact.toNumber() / 100;
}

export function validateSwapAmounts(
  inputAmount: BN,
  inputDecimals: number,
  outputAmount: BN
  // _outputDecimals: number
): { valid: boolean; error?: string } {
  if (inputAmount.lte(new BN(0))) {
    return { valid: false, error: 'Input amount must be greater than 0' };
  }

  if (outputAmount.lte(new BN(0))) {
    return { valid: false, error: 'Output amount must be greater than 0' };
  }

  const minInput = new BN(10).pow(new BN(inputDecimals - 3)); // 0.001 of token
  if (inputAmount.lt(minInput)) {
    return { valid: false, error: 'Input amount too small' };
  }

  return { valid: true };
}
