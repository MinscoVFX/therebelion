import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// Meteora DBC Program ID (mainnet)
const DBC_PROGRAM_ID = new PublicKey('DBC8Zko9Bw7ZcL2v55AKbU9iVdKFGQX3LwHZ6Hqu1CMB');

interface DbcPoolKeys {
  pool: string;
  feeVault: string;
}

interface RequestBody {
  owner: string;
  dbcPoolKeys: DbcPoolKeys;
  priorityMicros?: number;
  slippageBps?: number;
  simulateOnly?: boolean;
  computeUnitLimit?: number;
}

// Meteora DBC claim trading fee instruction layout
function createClaimTradingFeeInstruction(
  pool: PublicKey,
  feeVault: PublicKey,
  claimer: PublicKey,
  claimerTokenAccount: PublicKey,
): any {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt('0x123456789abcdef0'), 0); // Meteora claim instruction discriminator
  
  return {
    programId: DBC_PROGRAM_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: feeVault, isSigner: false, isWritable: true },
      { pubkey: claimer, isSigner: true, isWritable: false },
      { pubkey: claimerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    
    // Validate required fields
    if (!body.owner || !body.dbcPoolKeys?.pool || !body.dbcPoolKeys?.feeVault) {
      return NextResponse.json(
        { error: 'Missing required fields: owner, dbcPoolKeys.pool, dbcPoolKeys.feeVault' },
        { status: 400 }
      );
    }

    // Validate ranges
    const priorityMicros = Math.max(0, Math.min(body.priorityMicros || 250_000, 3_000_000));
    const slippageBps = Math.max(0, Math.min(body.slippageBps || 50, 10_000));
    const computeUnitLimit = body.computeUnitLimit ? 
      Math.max(50_000, Math.min(body.computeUnitLimit, 1_400_000)) : undefined;

    const connection = new Connection(
      process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );

    const owner = new PublicKey(body.owner);
    const pool = new PublicKey(body.dbcPoolKeys.pool);
    const feeVault = new PublicKey(body.dbcPoolKeys.feeVault);

    // Get fee vault info to determine token mint
    const feeVaultInfo = await connection.getAccountInfo(feeVault);
    if (!feeVaultInfo) {
      throw new Error('Fee vault not found');
    }

    // Parse token account data to get mint (first 32 bytes after discriminator)
    const mintBytes = feeVaultInfo.data.slice(0, 32);
    const tokenMint = new PublicKey(mintBytes);

    // Get or create user's token account
    const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, owner, false);

    const instructions = [];

    // Add compute budget instructions
    if (priorityMicros > 0) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicros })
      );
    }
    
    if (computeUnitLimit) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })
      );
    }

    // Ensure user token account exists
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        userTokenAccount,
        owner,
        tokenMint
      )
    );

    // Add DBC claim trading fee instruction
    instructions.push(
      createClaimTradingFeeInstruction(pool, feeVault, owner, userTokenAccount)
    );

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    // Create transaction
    const messageV0 = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);

    if (body.simulateOnly) {
      // Simulate transaction
      const simulation = await connection.simulateTransaction(tx, {
        commitment: 'confirmed',
        sigVerify: false,
      });

      return NextResponse.json({
        simulated: true,
        logs: simulation.value.logs || [],
        unitsConsumed: simulation.value.unitsConsumed || 0,
        error: simulation.value.err,
        tx: tx.serialize().toString('base64'),
        lastValidBlockHeight,
      });
    }

    return NextResponse.json({
      simulated: false,
      tx: tx.serialize().toString('base64'),
      lastValidBlockHeight,
    });

  } catch (error) {
    console.error('DBC exit API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
