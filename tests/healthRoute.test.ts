import { describe, it, expect } from 'vitest';

describe('health route (NextJS app router)', () => {
  it('returns ok true with runtime flags', async () => {
    const mod = await import('../scaffolds/fun-launch/src/app/api/health/route');
    const res = await mod.GET();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.runtime).toBeTypeOf('object');
    expect(Object.prototype.hasOwnProperty.call(json.runtime, 'dbc')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(json.runtime, 'damm_v2')).toBe(true);
  });
});
