import { describe, it, expect, beforeEach } from 'vitest';

// We will dynamically import the route module after setting env vars so it picks them up.

describe('health API route', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('ok when only RPC_URL is set', async () => {
    process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
    const mod = await import('../scaffolds/fun-launch/src/app/api/health/route');
    const res: any = await mod.GET({} as any);
    const json = await res.json();
    expect(json.env.errors.length).toBe(0);
    expect(json.env.details.RPC_SELECTED).toBeDefined();
  });

  it('fails when none of the RPC vars set', async () => {
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINT;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    const mod = await import('../scaffolds/fun-launch/src/app/api/health/route');
    const res: any = await mod.GET({} as any);
    const json = await res.json();
    expect(json.env.errors.some((e: string) => e.includes('Missing RPC endpoint'))).toBe(true);
  });
});
