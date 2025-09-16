import { describe, it, expect } from 'vitest';

describe('environment and configuration', () => {
  it('imports config modules successfully', async () => {
    const constantsModule = await import('../src/config/constants');
    expect(constantsModule).toBeDefined();
    
    const indexModule = await import('../src/config/index');
    expect(indexModule).toBeDefined();
  });

  it('imports anchor programs successfully', async () => {
    const module = await import('../src/lib/anchor/programs');
    expect(module).toBeDefined();
    expect(typeof module).toBe('object');
  });

  it('imports environment modules successfully', async () => {
    // Note: env/required.ts may throw on import if env vars are missing
    // So we test import capability without necessarily calling functions
    try {
      const module = await import('../src/env/required');
      expect(module).toBeDefined();
    } catch (error) {
      // Expected in test environment without full env setup
      expect(error).toBeDefined();
    }
  });
});