import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export interface DynamicPool {
  pubkey: PublicKey;
  account: {
    amountA: BN;
    amountB: BN;
    tokenAMint: PublicKey;
    tokenBMint: PublicKey;
    aVault: PublicKey;
    bVault: PublicKey;
    aVaultLp: PublicKey;
    bVaultLp: PublicKey;
    aVaultLpMint: PublicKey;
    bVaultLpMint: PublicKey;
    enabled: boolean;
    swapFeeRate: BN;
    protocolFeeRate: BN;
    fundFeeRate: BN;
    fundOwner: PublicKey;
  };
}

export interface SwapQuote {
  inAmount: BN;
  outAmount: BN;
  minOutAmount: BN;
  priceImpact: number;
  fee: BN;
}

export interface PoolState {
  tokenAAmount: BN;
  tokenBAmount: BN;
  price: number;
  tvl: number;
}

export interface DBCConfig {
  poolAddress: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  feeRate: number;
}
