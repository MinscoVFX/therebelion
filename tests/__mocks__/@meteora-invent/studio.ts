import { PublicKey, TransactionInstruction } from '@solana/web3.js';

const MOCK_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

function makeNoopInstruction(): TransactionInstruction {
  return new TransactionInstruction({
    programId: MOCK_PROGRAM_ID,
    keys: [],
    data: Buffer.alloc(0),
  });
}

export const damm_v2 = {
  async getAllPositionNftAccountByOwner(): Promise<[]> {
    return [];
  },
};

export const dbc = {
  async buildClaimTradingFeeIx(): Promise<TransactionInstruction> {
    return makeNoopInstruction();
  },
  async buildRemoveLiquidityIx(): Promise<TransactionInstruction> {
    return makeNoopInstruction();
  },
};

export default {
  damm_v2,
  dbc,
};
