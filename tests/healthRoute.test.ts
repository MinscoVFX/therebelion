/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';

// We will dynamically import the route module after setting env vars so it picks them up.

describe('health API route', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('ok when any RPC var is set', async () => {
    // Provide minimal required env for getEnv() strict schema used by the health route.
    process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
    process.env.ALLOWED_DBC_PROGRAM_IDS = JSON.stringify([
      'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'
    ]);
    process.env.ALLOWED_DAMM_V2_PROGRAM_IDS = JSON.stringify([
      'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'
    ]);
    process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME = 'auto';
    const mod = await import('../pages/api/health');
    let status = 0;
    const collector: any = {};
    await mod.default(
      {} as any,
      { status: (s: number) => ({ json: (j: any) => { status = s; Object.assign(collector, j); } }) } as any
    );
    expect(status).toBe(200);
    expect(collector.ok).toBe(true);
  });
  it('fails when none RPC set', async () => {
    delete process.env.RPC_URL;
    delete process.env.RPC_ENDPOINT;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    const mod = await import('../pages/api/health');
    let status = 0;
    const collector: any = {};
    await mod.default({} as any, { status: (s: number) => ({ json: (j: any) => { status = s; Object.assign(collector, j); } }) } as any);
    expect(status).toBe(500);
    expect(collector.ok).toBe(false);
  });
});
