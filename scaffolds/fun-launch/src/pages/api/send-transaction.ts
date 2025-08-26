import type { NextApiRequest, NextApiResponse } from 'next';
import {
  Connection,
  Transaction,
  PublicKey,
  SystemProgram,
  SystemInstruction,
  sendAndConfirmRawTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';

const RPC_URL = process.env.RPC_URL as string;
const CREATION_FEE_RECEIVER = process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER as string;
const FEE_LAMPORTS = 25_000_000; // 0.025 SOL

if (!RPC_URL || !CREATION_FEE_RECEIVER) {
  throw new Error('RPC_URL or NEXT_PUBLIC_CREATION_FEE_RECEIVER not configured');
}

type SendTransactionRequest = {
  signedTransaction: string; // base64-encoded signed transaction
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { signedTransaction } = req.body as SendTransactionRequest;
    if (!signedTransaction) return res.status(400).json({ error: 'Missing signed transaction' });

    const tx = Transaction.from(Buffer.from(signedTransaction, 'base64'));

    // --- Fee validation allowing leading ComputeBudget instructions ---
    const ixs = tx.instructions ?? [];
    if (ixs.length === 0) {
      return res.status(400).json({ error: 'Transaction has no instructions' });
    }

    // Skip any leading ComputeBudgetProgram instructions (narrow safely)
    let idx = 0;
    while (idx < ixs.length) {
      const ix = ixs[idx];
      if (!ix) break;
      if (!ix.programId.equals(ComputeBudgetProgram.programId)) break;
      idx++;
    }

    // The next instruction (after any compute budget Ixs) must be the 0.025 SOL transfer
    const feeIx = ixs[idx];
    if (!feeIx) {
      return res.status(400).json({ error: 'Missing creation fee instruction' });
    }
    if (!feeIx.programId.equals(SystemProgram.programId)) {
      return res.status(400).json({ error: 'Creation fee ix is not SystemProgram.transfer' });
    }

    let decoded;
    try {
      decoded = SystemInstruction.decodeTransfer(feeIx);
    } catch {
      return res.status(400).json({ error: 'Creation fee ix is not a valid SystemProgram.transfer' });
    }

    const toOk = (decoded.toPubkey as PublicKey).equals(new PublicKey(CREATION_FEE_RECEIVER));
    const lamportsOk = Number(decoded.lamports) === FEE_LAMPORTS;

    // Try to ensure the fee is paid by the fee payer (or first signer if feePayer omitted)
    const payer = tx.feePayer ?? (tx.signatures[0]?.publicKey as PublicKey | undefined);
    const fromOk = payer ? (decoded.fromPubkey as PublicKey).equals(payer) : true;

    if (!(toOk && lamportsOk && fromOk)) {
      return res.status(400).json({ error: 'Creation fee check failed' });
    }
    // --- End fee validation ---

    const connection = new Connection(RPC_URL, 'confirmed');

    const signature = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
      commitment: 'confirmed',
    });

    return res.status(200).json({ success: true, signature });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Transaction error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
