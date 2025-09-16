import { describe, it, expect, beforeAll } from 'vitest';

let withdrawAttemptCount = 0;

// Import the real builder then patch the specific export we need to control.
// Import with require so we can patch without TS merging of declaration types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const builder: any = require('../scaffolds/fun-launch/src/server/dbc-exit-builder');

const patched: any = builder;

// Patch build function (lightweight monkey-patch instead of vi.mock dynamic path complexity)
patched.buildDbcExitTransaction = async (_connection: unknown, opts: { action: string }) => {
  if (opts.action === 'withdraw') {
    withdrawAttemptCount += 1;
    throw new Error('withdraw instruction not supported (mock)');
  }
  if (opts.action === 'claim') {
    return {
      tx: { serialize: () => Buffer.from('deadbeef', 'hex') },
      lastValidBlockHeight: 123n,
    };
  }
  throw new Error('unexpected action in mock: ' + opts.action);
};

// Override meta helpers for deterministic output (optional)
patched.getClaimDiscriminatorMeta = () => ({ source: 'env', instructionName: 'claimFees' });
patched.getActiveClaimDiscriminatorHex = () => '0x1122334455667788';
patched.getWithdrawDiscriminatorMeta = () => ({ source: 'idl', instructionName: 'withdrawAll' });
patched.getActiveWithdrawDiscriminatorHex = () => '0xaabbccddeeff0011';

// Now import the route after patching builder
const routeImportPromise = import('../scaffolds/fun-launch/src/app/api/dbc-exit/route');

describe('dbc-exit withdraw-first runtime fallback', () => {
  let POST: (req: Request) => Promise<Response>;
  beforeAll(async () => {
    const mod = await routeImportPromise;
    POST = mod.POST;
  });

  it('falls back from withdraw to claim and returns fallback metadata', async () => {
    const body = {
      action: 'withdraw_first',
      owner: 'DummyOwner1111111111111111111111111111111',
      dbcPoolKeys: { pool: 'DummyPool111111111111111111111111111111111', feeVault: 'DummyFeeVault111111111111111111111111111111' },
      priorityMicros: 1000,
      computeUnitLimit: 100_000,
      slippageBps: 50,
    };
    const req = new Request('https://example.test/api/dbc-exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    if (typeof json !== 'object' || !json) throw new Error('Unexpected response shape');

    const j = json as Record<string, unknown>;
    expect(j.requestedAction).toBe('withdraw_first');
    expect(j.effectiveAction).toBe('claim');
    expect(j.fallback).toBeDefined();
    const fb = j.fallback as Record<string, unknown>;
    expect(fb.from).toBe('withdraw');
    expect(fb.to).toBe('claim');
    expect(typeof fb.reason).toBe('string');
    // ensure withdraw path actually attempted
    expect(withdrawAttemptCount).toBeGreaterThan(0);
  });
});
