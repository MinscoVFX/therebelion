import { describe, it, expect } from 'vitest';

// We simulate production by spawning a fresh Node process via dynamic import using a temporary shim file.
// Simpler: create a temporary copy of process.env values passed through an inline eval using node -e (skipped for performance) —
// Here we patch using a helper that constructs a dynamic import with modified env via process.env assignments are allowed in test context.

describe('DBC placeholder discriminator production guard', () => {
  it('throws when placeholder discriminator set in production', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
    const originalRpc = process.env.RPC_URL;
    const originalDisc = process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
    try {
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.RPC_URL = 'https://example';
      process.env.DBC_CLAIM_FEE_DISCRIMINATOR = 'ffffffffffffffff';
      // Dynamic import after clearing ESM cache by using a query param style (Node treats as unique specifier in ESM).
      let captured: unknown = null;
      // Force re-import by using a timestamp suffix constructing a new URL for dynamic import.
  const spec = '../src/env/required.ts?t=' + Date.now();
      try {
        await import(spec as string);
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeTruthy();
      expect(String((captured as Error).message)).toMatch(/placeholder/);
    } finally {
  (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
      process.env.RPC_URL = originalRpc;
      if (originalDisc) process.env.DBC_CLAIM_FEE_DISCRIMINATOR = originalDisc; else delete process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
    }
  });
});
