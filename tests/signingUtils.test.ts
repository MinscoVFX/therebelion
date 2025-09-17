import { describe, it, expect, vi } from 'vitest';
import { signTransactionsAdaptive } from '../scaffolds/fun-launch/src/hooks/signingUtils';
import { VersionedTransaction, TransactionMessage, PublicKey } from '@solana/web3.js';

function dummyTx(): VersionedTransaction {
  // Minimal empty v0 message (payer dummy) – just for structure; not sent.
  const payer = new PublicKey('11111111111111111111111111111111');
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [],
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

describe('signTransactionsAdaptive', () => {
  it('uses batch path when available', async () => {
    const txs = [dummyTx(), dummyTx()];
    const wallet = {
      signAllTransactions: vi.fn(async (arr: VersionedTransaction[]) => arr.map((t) => t)),
      signTransaction: vi.fn(),
    };
    const res = await signTransactionsAdaptive(wallet, txs);
    expect(res.usedBatch).toBe(true);
    expect(wallet.signAllTransactions).toHaveBeenCalledTimes(1);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('falls back to serial when batch missing', async () => {
    const txs = [dummyTx(), dummyTx()];
    const wallet = {
      signTransaction: vi.fn(async (t: VersionedTransaction) => t),
    };
    const res = await signTransactionsAdaptive(wallet, txs);
    expect(res.usedBatch).toBe(false);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(2);
    expect(res.errors).toEqual([null, null]);
  });

  it('records individual errors in serial mode', async () => {
    const txs = [dummyTx(), dummyTx()];
    const wallet = {
      signTransaction: vi
        .fn()
        .mockImplementationOnce(async (t: VersionedTransaction) => t)
        .mockImplementationOnce(async () => {
          throw new Error('boom');
        }),
    };
    const res = await signTransactionsAdaptive(wallet, txs);
    expect(res.usedBatch).toBe(false);
    expect(res.errors[0]).toBeNull();
    expect(res.errors[1]).toBe('boom');
  });
});
