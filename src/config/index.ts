import { PublicKey } from '@solana/web3.js';

export interface AppConfig {
  solana: {
    rpcUrl: string;
    wsUrl: string;
    commitment: 'confirmed' | 'finalized' | 'processed';
  };
  meteora: {
    programId: PublicKey;
    pools: {
      [key: string]: PublicKey;
    };
  };
  tokens: {
    [symbol: string]: {
      mint: PublicKey;
      decimals: number;
      symbol: string;
      name: string;
    };
  };
}

export const config: AppConfig = {
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
    commitment: 'confirmed',
  },
  meteora: {
    programId: new PublicKey('METAewgxyPbgwsseH8T16a39CQ5VyVxZi9zXiDPY18m'),
    pools: {
      // Add specific pool addresses here
    },
  },
  tokens: {
    SOL: {
      mint: new PublicKey('So11111111111111111111111111111111111111112'),
      decimals: 9,
      symbol: 'SOL',
      name: 'Solana',
    },
    USDC: {
      mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
    },
  },
};

export default config;
