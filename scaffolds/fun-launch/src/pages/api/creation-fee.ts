import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

/**
 * Builds a 0.025 SOL transfer from the payer (user) to your partner wallet.
 * Returns base64-encoded transaction for client to sign and send.
 *
 * Env required:
 * - RPC_URL (server-side)
 * - NEXT_PUBLIC_CREATION_FEE_RECEIVER (public wallet OK)
 */
const LAMPORTS_0_025 = 25_000_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { payer } = (req.body || {}) as { payer?: string };
    if (!payer) return res.status(400).json({ error: 'Missing payer' });

    const rpc = process.env.RPC_URL;
    if (!rpc) return res.status(500).json({ error: 'RPC_URL is not configured on the server' });

    const receiver = process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER;
    if (!receiver) {
      return res.status(500).json({ error: 'NEXT_PUBLIC_CREATION_FEE_RECEIVER is not set' });
    }

    const connection = new Connection(rpc, 'confirmed');
    const fromPubkey = new PublicKey(payer);
    const toPubkey = new PublicKey(receiver);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: LAMPORTS_0_025,
      })
    );

    tx.feePayer = fromPubkey;
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const txBase64 = Buffer.from(serialized).toString('base64');

    return res.status(200).json({ tx: txBase64 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
}
