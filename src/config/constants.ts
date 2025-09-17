import { PublicKey } from '@solana/web3.js';

export const NETWORK = process.env.NODE_ENV === 'production' ? 'mainnet-beta' : 'devnet';

export const RPC_ENDPOINTS = {
  'mainnet-beta': process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com',
  devnet: process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
};

export const PROGRAM_IDS = {
  METEORA_DLMM: new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'),
  TOKEN_PROGRAM: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  ASSOCIATED_TOKEN_PROGRAM: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  SYSTEM_PROGRAM: new PublicKey('11111111111111111111111111111111'),
  RENT_PROGRAM: new PublicKey('SysvarRent111111111111111111111111111111111'),
};

export const TOKENS = {
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
  USDT: {
    mint: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
    decimals: 6,
    symbol: 'USDT',
    name: 'Tether USD',
  },
};

export const FEES = {
  PLATFORM_FEE_BPS: 300, // 3%
  METEORA_FEE_BPS: 25, // 0.25%
  SLIPPAGE_BPS: 50, // 0.5% default slippage
};

export const LIMITS = {
  MIN_SOL_AMOUNT: 0.001,
  MAX_SOL_AMOUNT: 1000,
  MIN_TOKEN_SUPPLY: 1000000,
  MAX_TOKEN_SUPPLY: 1000000000000,
};
