import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

export interface TokenInfo {
  mint: PublicKey;
  decimals: number;
  symbol: string;
  name: string;
  logoURI?: string;
}

export interface LaunchpadProject {
  id: string;
  name: string;
  symbol: string;
  description: string;
  tokenMint: PublicKey;
  totalSupply: BN;
  presaleSupply: BN;
  price: number;
  startTime: Date;
  endTime: Date;
  minContribution: BN;
  maxContribution: BN;
  status: 'upcoming' | 'active' | 'ended' | 'cancelled';
  raised: BN;
  participants: number;
  creator: PublicKey;
  poolAddress?: PublicKey;
}

export interface UserContribution {
  user: PublicKey;
  amount: BN;
  timestamp: Date;
  claimed: boolean;
}

export interface SwapQuote {
  inputAmount: BN;
  outputAmount: BN;
  minimumReceived: BN;
  priceImpact: number;
  fee: BN;
  route: string[];
}

export interface PoolInfo {
  address: PublicKey;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  reserveA: BN;
  reserveB: BN;
  totalLiquidity: BN;
  apy: number;
  volume24h: BN;
  fees24h: BN;
}

export interface TransactionResult {
  signature: string;
  success: boolean;
  error?: string;
}

export interface WalletContextType {
  connected: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
}
