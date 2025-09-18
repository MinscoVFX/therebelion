import { PublicKey, Connection, Transaction } from '@solana/web3.js';
import { buildWithdrawAllIx } from './dammv2';

type PoolKeys = {
  programId: PublicKey;
  pool: PublicKey;
  lpMint: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  authorityPda: PublicKey;
};

interface UniversalExitParams {
  connection: Connection;
  owner: PublicKey;
  poolKeys: PoolKeys;
  priorityMicros?: number;
}

export async function plan({ connection, owner, poolKeys, priorityMicros }: UniversalExitParams) {
  // For demo, just return a single step
  // Use connection and owner to avoid unused variable warnings
  void connection;
  void owner;
  return {
    steps: [
      {
        action: 'withdrawAll',
        pool: poolKeys?.pool?.toString?.() || '',
        priorityMicros: priorityMicros || 250_000,
      },
    ],
    notes: ['Plan: withdraw all DAMM v2 liquidity'],
    estUnits: 50000,
    skips: [],
  };
}

export async function execute({
  connection,
  owner,
  poolKeys,
  priorityMicros,
}: UniversalExitParams) {
  try {
    const ixs = await buildWithdrawAllIx({ connection, owner, poolKeys, priorityMicros });
    const tx = new Transaction().add(...(ixs || []));
    tx.feePayer = owner;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    // For backend, sign with Keypair; for frontend, use wallet adapter
    // @ts-expect-error
    const signedTx = await owner.signTransaction(tx);
    const txid = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
    });
    await connection.confirmTransaction(txid, 'confirmed');
    return { status: 'success', txid };
  } catch (err: unknown) {
    let errorMsg = 'Unknown error';
    if (err && typeof err === 'object' && 'message' in err) {
      errorMsg = (err as { message: string }).message;
    } else {
      errorMsg = String(err);
    }
    return { status: 'error', error: errorMsg };
  }
}

export async function universalExit(params: UniversalExitParams) {
  return await execute(params);
}
