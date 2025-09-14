declare module '@meteora-invent/studio/lib/dbc' {
  import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
  export type DbcPoolKeys = { pool: PublicKey; feeVault: PublicKey };
  export function buildClaimTradingFeeIx(args: {
    connection: Connection;
    poolKeys: DbcPoolKeys;
    feeClaimer: PublicKey;
  }): Promise<TransactionInstruction>;
}
declare module '@meteora-invent/studio/lib/damm_v2' {
  import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
  export type DammV2PoolKeys = {
    programId: PublicKey;
    pool: PublicKey;
    lpMint: PublicKey;
    tokenAMint: PublicKey;
    tokenBMint: PublicKey;
    tokenAVault: PublicKey;
    tokenBVault: PublicKey;
    authorityPda: PublicKey;
  };
  export async function getPoolByLpMint(args: {
    connection: Connection;
    lpMint: PublicKey;
  }): Promise<DammV2PoolKeys | null>;
  export function buildRemoveLiquidityIx(args: {
    programId: PublicKey;
    pool: PublicKey;
    authorityPda: PublicKey;
    lpMint: PublicKey;
    tokenAVault: PublicKey;
    tokenBVault: PublicKey;
    user: PublicKey;
    userLpAccount: PublicKey;
    userAToken: PublicKey;
    userBToken: PublicKey;
    lpAmount: bigint;
  }): Promise<TransactionInstruction | TransactionInstruction[]>;
}
