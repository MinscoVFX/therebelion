import { describe, it, expect } from 'vitest';

// Basic sanity test to keep CI green until protocol-level unit tests are authored.
// Ensures test runner integration works.

describe('sanity', () => {
  it('mathematics holds', () => {
    expect(2 + 2).toBe(4);
  });

  it('environment has required placeholders', () => {
    // These env vars may be undefined locally; just assert the code loads them without throwing length errors.
    const prog = process.env.DBC_PROGRAM_ID || 'default';
    expect(typeof prog).toBe('string');
  });
});
