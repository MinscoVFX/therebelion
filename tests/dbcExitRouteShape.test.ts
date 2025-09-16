import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('dbc-exit route response shape', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      RPC_ENDPOINT: ORIGINAL_ENV.RPC_ENDPOINT || 'http://localhost:8899',
    };
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('aliases txBase64 to tx for consumers expecting tx field', async () => {
    const serialized = Buffer.from('0011', 'hex');
    vi.doMock('../scaffolds/fun-launch/src/server/dbc-exit-builder', () => ({
      __esModule: true,
      buildDbcExitTransaction: vi.fn(async () => ({
        tx: { serialize: () => serialized },
        lastValidBlockHeight: 999,
      })),
      getClaimDiscriminatorMeta: vi.fn(() => null),
      getActiveClaimDiscriminatorHex: vi.fn(() => 'aaaaaaaaaaaaaaaa'),
      getWithdrawDiscriminatorMeta: vi.fn(() => null),
      getActiveWithdrawDiscriminatorHex: vi.fn(() => 'bbbbbbbbbbbbbbbb'),
    }));

    const { POST } = await import('../scaffolds/fun-launch/src/app/api/dbc-exit/route');

    const request = new Request('http://localhost/api/dbc-exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: 'owner1111111111111111111111111111111111',
        dbcPoolKeys: {
          pool: 'pool1111111111111111111111111111111111',
          feeVault: 'fee1111111111111111111111111111111111',
        },
        action: 'claim',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toMatchObject({
      simulated: false,
      lastValidBlockHeight: 999,
      tx: expect.any(String),
      txBase64: expect.any(String),
    });
    expect(json.tx).toBe(serialized.toString('base64'));
    expect(json.txBase64).toBe(json.tx);
  });
});
