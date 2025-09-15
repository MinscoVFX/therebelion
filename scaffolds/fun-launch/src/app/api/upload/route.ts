import { NextResponse } from 'next/server';
import { Connection, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { resolveRpc } from '../../../lib/rpc';

// Simplified placeholder: builds a dummy transaction representing pool creation.
// In production this should:
// 1. Validate image + metadata, upload to storage
// 2. Create mint + metadata instructions
// 3. (Optionally) include initial fee transfers / memo
// 4. Return base64 serialized create tx plus pool address (predictable PDA or mint based)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const mintStr: string | undefined = body.mint;
    const userWallet: string | undefined = body.userWallet;
    if (!mintStr || !userWallet) {
      return NextResponse.json({ error: 'mint and userWallet required' }, { status: 400 });
    }
  const connection = new Connection(resolveRpc(), 'confirmed');
    const recent = await connection.getLatestBlockhash();

    // Dummy tx: system program transfer 0 lamports (no-op) just to have a valid container
    const tx = new Transaction({ feePayer: new PublicKey(userWallet), blockhash: recent.blockhash, lastValidBlockHeight: recent.lastValidBlockHeight });
    // Could add memo or compute budget instructions here
    tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(userWallet), toPubkey: new PublicKey(userWallet), lamports: 0 }));

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    return NextResponse.json({ poolTx: serialized, pool: mintStr });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
