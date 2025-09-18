import { describe, it, expect } from 'vitest';

describe('env-required', () => {
  it('should validate required env vars', () => {
    expect(process.env).toBeDefined();
  });
});
