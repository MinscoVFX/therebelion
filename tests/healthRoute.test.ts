import { describe, it, expect, beforeEach } from 'vitest';

// We will dynamically import the route module after setting env vars so it picks them up.

describe('health API route (pages version)', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    process.env = { ...ORIGINAL };
    delete process.env.RPC_URL; // legacy var not used in new handler
  });

  it('ok when only NEXT_PUBLIC_RPC_URL is set', async () => {
    process.env.NEXT_PUBLIC_RPC_URL = 'https://api.mainnet-beta.solana.com';
    // Provide discriminator + pool config so handler reports ok (no critical warnings)
    process.env.DBC_CLAIM_FEE_DISCRIMINATOR = '0123456789abcdef';
    process.env.POOL_CONFIG_KEY = 'DummyPoolConfigPubkey1111111111111111111111111';
    const mod = await import('../scaffolds/fun-launch/src/pages/api/health');
    // pages api exports default handler(req,res)
    const req = {} as any;
    const statusCapture: any = { code: 0 };
    let jsonPayload: any = null;
    const res: any = {
      status(code: number) { statusCapture.code = code; return this; },
      json(obj: any) { jsonPayload = obj; return this; },
    };
    await mod.default(req, res);
    expect(statusCapture.code).toBe(200);
    expect(jsonPayload.ok).toBe(true);
    expect(jsonPayload.env.NEXT_PUBLIC_RPC_URL).toBe(true);
  });

  it('fails when no RPC vars set', async () => {
    delete process.env.RPC_ENDPOINT;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    const mod = await import('../scaffolds/fun-launch/src/pages/api/health');
    const req = {} as any;
    const statusCapture: any = { code: 0 };
    let jsonPayload: any = null;
    const res: any = {
      status(code: number) { statusCapture.code = code; return this; },
      json(obj: any) { jsonPayload = obj; return this; },
    };
    await mod.default(req, res);
    expect(statusCapture.code).toBe(500);
    expect(jsonPayload.ok).toBe(false);
    expect(jsonPayload.warnings.some((w: string) => w.toLowerCase().includes('rpc'))).toBe(true);
  });
});
