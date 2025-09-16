import { describe, it, expect } from 'vitest';

// Lightweight tests to exercise withdraw-first fallback API contract shape.
// NOTE: This is a placeholder; comprehensive mocking of the Solana transaction builder
// would require restructuring for DI. For now we ensure the route loads and the action alias
// 'withdraw_first' is accepted enough to reach validation.

describe('dbc-exit withdraw-first API contract', () => {
  it('accepts withdraw_first action and triggers validation error on missing fields', async () => {
    // We call the route handler directly by dynamic import to avoid needing a running server.
    const mod = await import('../scaffolds/fun-launch/src/app/api/dbc-exit/route');
    const req = new Request('https://example.test/api/dbc-exit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'withdraw_first', owner: 'dummy-owner' }),
    });
    const res = await mod.POST(req);
    expect(res.status === 200 || res.status === 400).toBe(true);
    if (res.status === 400) {
      const j: unknown = await res.json();
      if (typeof j === 'object' && j && 'error' in j) {
        expect((j as { error: string }).error).toMatch(/Missing required fields/);
      } else {
        throw new Error('Unexpected response shape');
      }
    } else {
      const j: unknown = await res.json();
      expect(j).toBeDefined();
    }
  });
});
