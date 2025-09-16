/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// Use dynamic import so env-dependent modules evaluate after we adjust globals if needed

describe('services: connection + meteora', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('connectionService falls back to default RPC when resolveRpc throws', async () => {
    vi.mock('@/lib/rpc', () => ({ resolveRpc: () => { throw new Error('missing env'); } }));
  const { connectionService } = await import('../src/services/connection');
    const conn = connectionService.getConnection();
    expect(typeof conn.rpcEndpoint).toBe('string');
  });

  it('connectionService health returns false on slot error', async () => {
    const fake = { getSlot: vi.fn().mockRejectedValue(new Error('slot fail')) };
    vi.mock('@solana/web3.js', async (orig) => {
      const base: any = await orig();
      class FakeConnection extends base.Connection {
        constructor() { super('http://localhost:1234'); }
        getSlot(): Promise<number> { return fake.getSlot(); }
      }
      return { ...base, Connection: FakeConnection };
    });
  const { connectionService } = await import('../src/services/connection');
    const ok = await connectionService.getHealth();
    expect(ok).toBe(false);
  });

  it('MeteoraService getPoolInfo returns mock object on existing account', async () => {
    const acctInfo = { data: new Uint8Array(100) };
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(acctInfo as any);
  const { MeteoraService } = await import('../src/services/meteora');
    const svc = new MeteoraService(new Connection('http://localhost:8899'));
    const pk = new PublicKey('11111111111111111111111111111111');
    const info = await svc.getPoolInfo(pk);
    expect(info?.address.toBase58()).toBe(pk.toBase58());
    expect(info?.tokenA).toBeDefined();
  });

  it('MeteoraService getPoolInfo returns null on error', async () => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockRejectedValue(new Error('fail'));
  const { MeteoraService } = await import('../src/services/meteora');
    const svc = new MeteoraService(new Connection('http://localhost:8899'));
    const info = await svc.getPoolInfo(new PublicKey('11111111111111111111111111111111'));
    expect(info).toBeNull();
  });

  it('MeteoraService getSwapQuote returns computed values', async () => {
  const { MeteoraService } = await import('../src/services/meteora');
    const svc = new MeteoraService(new Connection('http://localhost:8899'));
  // Use two distinct valid base58 public keys (System Program and a made-up but valid 32-byte key)
  const inMint = new PublicKey('11111111111111111111111111111111'); // system program (all ones) is valid
  const outMint = new PublicKey('2n5R9Z3QmrxgVtKJp1pC5aYVY1xq4oX7kK9PpLx9d9qS');
    const inputAmount = new BN(1000);
    const quote = await svc.getSwapQuote(inMint, outMint, inputAmount, 100); // 1% slippage
  expect(quote).not.toBeNull();
  if (!quote) throw new Error('quote should not be null');
  expect(quote.outputAmount.toString()).toBe('950');
  expect(quote.minimumReceived.toString()).toBe('941');
  });

  it('MeteoraService createSwapTransaction builds ATA and transfer', async () => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null as any); // Force ATA creation path
  const { MeteoraService } = await import('../src/services/meteora');
    const svc = new MeteoraService(new Connection('http://localhost:8899'));
    const user = new PublicKey('11111111111111111111111111111111');
    const tx = await svc.createSwapTransaction(user, user, user);
  expect(tx).toBeInstanceOf(Transaction);
  if (!tx) throw new Error('tx should be defined');
  expect(tx.instructions.length).toBeGreaterThanOrEqual(2); // create ATA + transfer
  });

  it('MeteoraService executeSwap returns success flag from confirmation', async () => {
    const confirm = vi.spyOn(Connection.prototype, 'confirmTransaction').mockResolvedValue({ value: { err: null } } as any);
  const { MeteoraService } = await import('../src/services/meteora');
    const svc = new MeteoraService(new Connection('http://localhost:8899'));
    const res = await svc.executeSwap(new Transaction(), 'abc');
    expect(confirm).toHaveBeenCalled();
    expect(res.success).toBe(true);
  });

  it('MeteoraService executeSwap handles error', async () => {
    vi.spyOn(Connection.prototype, 'confirmTransaction').mockRejectedValue(new Error('net fail'));
  const { MeteoraService } = await import('../src/services/meteora');
    const svc = new MeteoraService(new Connection('http://localhost:8899'));
    const res = await svc.executeSwap(new Transaction(), 'def');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/net fail/);
  });
});
