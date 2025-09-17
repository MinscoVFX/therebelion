import { describe, it, expect } from 'vitest';

describe('API routes module loading', () => {
  it('imports upload route successfully', async () => {
    const module = await import('../scaffolds/fun-launch/src/app/api/upload/route');
    expect(module).toBeDefined();
    expect(typeof module.POST).toBe('function');
  });

  it('imports send-transaction route successfully', async () => {
    const module = await import('../scaffolds/fun-launch/src/app/api/send-transaction/route');
    expect(module).toBeDefined();
    expect(typeof module.POST).toBe('function');
  });

  it('imports exit-auto route successfully', async () => {
    const module = await import('../scaffolds/fun-launch/src/app/api/exit-auto/route');
    expect(module).toBeDefined();
    expect(typeof module.POST).toBe('function');
  });
});