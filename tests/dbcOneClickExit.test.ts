import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, PublicKey, type VersionedTransaction } from '@solana/web3.js';
import { POST } from '../scaffolds/fun-launch/src/app/api/dbc-one-click-exit/route';

const adapterMocks = vi.hoisted(() => ({
  scanDbcPositionsUltraSafe: vi.fn(),
  discoverMigratedDbcPoolsViaNfts: vi.fn(),
  discoverMigratedDbcPoolsViaMetadata: vi.fn(),
}));

const builderMocks = vi.hoisted(() => ({
  buildDbcExitTransaction: vi.fn(),
}));

vi.mock('../scaffolds/fun-launch/src/server/dbc-adapter', () => ({
  __esModule: true,
  scanDbcPositionsUltraSafe: adapterMocks.scanDbcPositionsUltraSafe,
  discoverMigratedDbcPoolsViaNfts: adapterMocks.discoverMigratedDbcPoolsViaNfts,
  discoverMigratedDbcPoolsViaMetadata: adapterMocks.discoverMigratedDbcPoolsViaMetadata,
}));

vi.mock('../scaffolds/fun-launch/src/server/dbc-exit-builder', () => ({
  __esModule: true,
  buildDbcExitTransaction: builderMocks.buildDbcExitTransaction,
}));

const ORIGINAL_ENV = { ...process.env };

describe('dbc-one-click-exit route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns validation error when owner pubkey is missing', async () => {
    process.env.RPC_ENDPOINT = 'http://localhost:8899';

    const request = new Request('http://localhost/api/dbc-one-click-exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Missing ownerPubkey',
    });

    expect(adapterMocks.scanDbcPositionsUltraSafe).not.toHaveBeenCalled();
  });

  it('propagates RPC configuration errors', async () => {
    delete process.env.RPC_ENDPOINT;
    delete process.env.RPC_URL;
    delete process.env.NEXT_PUBLIC_RPC_URL;

    const owner = new PublicKey('11111111111111111111111111111111');

    const request = new Request('http://localhost/api/dbc-one-click-exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerPubkey: owner.toBase58() }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('RPC missing'),
    });
  });

  it('returns a serialized transaction when a position is discovered', async () => {
    process.env.RPC_ENDPOINT = 'http://localhost:8899';

    const owner = Keypair.generate().publicKey;
    const pool = Keypair.generate().publicKey;
    const feeVault = Keypair.generate().publicKey;

    adapterMocks.scanDbcPositionsUltraSafe.mockResolvedValue([
      {
        poolKeys: {
          pool,
          feeVault,
        },
        lpAmount: 10n,
      },
    ]);
    adapterMocks.discoverMigratedDbcPoolsViaNfts.mockResolvedValue([]);
    adapterMocks.discoverMigratedDbcPoolsViaMetadata.mockResolvedValue([]);

    const serialized = Buffer.from('deadbeef', 'hex');
    const fakeTx = { serialize: () => serialized } as unknown as VersionedTransaction;
    builderMocks.buildDbcExitTransaction.mockResolvedValue({
      tx: fakeTx,
      lastValidBlockHeight: 123,
    });

    const request = new Request('http://localhost/api/dbc-one-click-exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerPubkey: owner.toBase58() }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      tx: serialized.toString('base64'),
      selectedPool: { pool: pool.toBase58(), feeVault: feeVault.toBase58() },
      totalPositions: 1,
    });

    expect(builderMocks.buildDbcExitTransaction).toHaveBeenCalledWith(expect.anything(), {
      owner: owner.toBase58(),
      dbcPoolKeys: { pool: pool.toBase58(), feeVault: feeVault.toBase58() },
      action: 'claim_and_withdraw',
      priorityMicros: 250_000,
      computeUnitLimit: 400_000,
      slippageBps: 100,
      simulateOnly: false,
    });
  });
});