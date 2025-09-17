import { NextResponse } from 'next/server';
import { Connection, VersionedTransaction, Transaction } from '@solana/web3.js';
// Local scaffold RPC resolver mirrors root resolver logic
import { resolveRpc } from '@/lib/rpc';
const _resolveRpc = resolveRpc;

function decodeTx(b64: string): VersionedTransaction | Transaction {
  const buf = Buffer.from(b64, 'base64');
  // Heuristic: try versioned first, fall back to legacy Transaction
  try {
    return VersionedTransaction.deserialize(buf);
  } catch {
    // Not a VersionedTransaction; fall through to legacy decode
  }
  try {
    return Transaction.from(buf);
  } catch {
    throw new Error('invalid transaction encoding');
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { signedTransaction, signedTransactions, waitForLanded } = body;
    const connection = new Connection(_resolveRpc(), 'confirmed');

    const txs: (VersionedTransaction | Transaction)[] = [];
    if (signedTransaction) txs.push(decodeTx(signedTransaction));
    if (Array.isArray(signedTransactions)) {
      for (const s of signedTransactions) txs.push(decodeTx(s));
    }
    if (!txs.length)
      return NextResponse.json({ error: 'no transactions provided' }, { status: 400 });

    const sigs: string[] = [];
    for (const tx of txs) {
      // Both Transaction and VersionedTransaction expose serialize()
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const raw = tx.serialize();
      const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
      sigs.push(sig);
    }

    if (waitForLanded) {
      // Confirm last one as representative
      const last = sigs[sigs.length - 1];
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        {
          signature: last,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'confirmed'
      );
      return NextResponse.json({ success: true, signatures: sigs, status: 'confirmed' });
    }

    return NextResponse.json({ success: true, signatures: sigs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
