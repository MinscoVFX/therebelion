import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

// Required env
const RPC_URL = process.env.RPC_URL as string;
if (!RPC_URL) throw new Error('RPC_URL missing');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { baseMint, userWallet, amountSol, slippageBps = 100 } = req.body || {};

    if (!baseMint || !userWallet || amountSol == null) {
      return res.status(400).json({ error: 'Missing baseMint, userWallet, or amountSol' });
    }

    const solInLamports = Math.floor(Number(amountSol) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(solInLamports) || solInLamports <= 0) {
      return res.status(400).json({ error: 'amountSol must be > 0' });
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const client = new DynamicBondingCurveClient(connection, 'confirmed');

    // Build a BUY on the DBC pool for this mint using SOL as input.
    // SDKs sometimes return a Transaction, sometimes instructions, sometimes an object.
    const resp = await client.swap.buy({
      baseMint: new PublicKey(baseMint),
      payer: new PublicKey(userWallet),
      solIn: BigInt(solInLamports),
      slippageBps, // 100 = 1%
    } as any);

    let tx: Transaction;
    if (resp instanceof Transaction) {
      tx = resp;
    } else if (Array.isArray(resp)) {
      tx = new Transaction().add(...resp);
    } else if (resp && typeof resp === 'object' && 'transaction' in resp) {
      tx = (resp as any).transaction as Transaction;
    } else {
      throw new Error('Unexpected response from DBC buy');
    }

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.feePayer = new PublicKey(userWallet);
    tx.recentBlockhash = blockhash;

    return res
      .status(200)
      .json({ buyTx: tx.serialize({ requireAllSignatures: false }).toString('base64') });
  } catch (e: any) {
    console.error('dbc-prebuy error:', e);
    return res.status(500).json({ error: e?.message || 'failed to build buy transaction' });
  }
}
