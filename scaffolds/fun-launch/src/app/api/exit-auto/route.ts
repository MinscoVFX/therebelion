import { NextResponse } from 'next/server';
import { Connection, VersionedTransaction, TransactionMessage, SystemProgram, PublicKey } from '@solana/web3.js';

// Auto-exit placeholder: build a trivial versioned tx so UI flow works.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { ownerPubkey, priorityMicros } = body;
    if (!ownerPubkey) return NextResponse.json({ error: 'ownerPubkey required' }, { status: 400 });

    const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const payer = new PublicKey(ownerPubkey);
    const msg = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 }),
      ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);
    const b64 = Buffer.from(vtx.serialize()).toString('base64');

    return NextResponse.json({ tx: b64, lastValidBlockHeight, priorityMicrosUsed: priorityMicros || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
