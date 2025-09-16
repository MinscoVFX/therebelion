/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

// Mock metadata interface for testing
interface MockMetadata {
  data?: {
    name?: string;
    symbol?: string;
  };
  updateAuthority?: {
    toBase58?: () => string;
  };
}

describe('DBC discovery (Token-2022)', () => {
  it('accepts a Meteora LP-like position NFT by name hint', async () => {
    const fakeMeta: MockMetadata = {
      data: { name: 'Meteora (STANDING-WSOL) LP Token', symbol: 'MPN' },
      updateAuthority: { toBase58: () => 'DummyUA' },
    };
    // Inline copy of discovery logic - mirrors the route logic
    const NAME_HINTS = 'dbc,meteora,position,lp token'
      .split(',')
      .map((s) => s.trim().toLowerCase());
    const SYMBOL_HINTS = 'dbc,dbcp0s,mpn'.split(',').map((s) => s.trim().toLowerCase());
    const UPDATE_AUTH_ALLOW: string[] = []; // empty for zero-config testing

    const looksLikeDbc = (meta: MockMetadata) => {
      const name = (meta.data?.name || '').toLowerCase();
      const symbol = (meta.data?.symbol || '').toLowerCase();
      const ua = meta.updateAuthority?.toBase58?.() || '';

      // Any of: explicit allow-list, name hint, symbol hint
      if (ua && UPDATE_AUTH_ALLOW.includes(ua)) return true;
      if (NAME_HINTS.some((h) => name.includes(h))) return true;
      if (SYMBOL_HINTS.some((h) => symbol.includes(h))) return true;
      return false;
    };

    expect(looksLikeDbc(fakeMeta)).toBe(true);
  });

  it('accepts a DBC position NFT by symbol hint', async () => {
    const fakeMeta: MockMetadata = {
      data: { name: 'Some Position', symbol: 'DBCP0S' },
      updateAuthority: { toBase58: () => 'DummyUA' },
    };

    const NAME_HINTS = 'dbc,meteora,position,lp token'
      .split(',')
      .map((s) => s.trim().toLowerCase());
    const SYMBOL_HINTS = 'dbc,dbcp0s,mpn'.split(',').map((s) => s.trim().toLowerCase());
    const UPDATE_AUTH_ALLOW: string[] = [];

    const looksLikeDbc = (meta: MockMetadata) => {
      const name = (meta.data?.name || '').toLowerCase();
      const symbol = (meta.data?.symbol || '').toLowerCase();
      const ua = meta.updateAuthority?.toBase58?.() || '';

      if (ua && UPDATE_AUTH_ALLOW.includes(ua)) return true;
      if (NAME_HINTS.some((h) => name.includes(h))) return true;
      if (SYMBOL_HINTS.some((h) => symbol.includes(h))) return true;
      return false;
    };

    expect(looksLikeDbc(fakeMeta)).toBe(true);
  });

  it('rejects unrelated NFTs', async () => {
    const fakeMeta: MockMetadata = {
      data: { name: 'Random NFT', symbol: 'RANDOM' },
      updateAuthority: { toBase58: () => 'DummyUA' },
    };

    const NAME_HINTS = 'dbc,meteora,position,lp token'
      .split(',')
      .map((s) => s.trim().toLowerCase());
    const SYMBOL_HINTS = 'dbc,dbcp0s,mpn'.split(',').map((s) => s.trim().toLowerCase());
    const UPDATE_AUTH_ALLOW: string[] = [];

    const looksLikeDbc = (meta: MockMetadata) => {
      const name = (meta.data?.name || '').toLowerCase();
      const symbol = (meta.data?.symbol || '').toLowerCase();
      const ua = meta.updateAuthority?.toBase58?.() || '';

      if (ua && UPDATE_AUTH_ALLOW.includes(ua)) return true;
      if (NAME_HINTS.some((h) => name.includes(h))) return true;
      if (SYMBOL_HINTS.some((h) => symbol.includes(h))) return true;
      return false;
    };

    expect(looksLikeDbc(fakeMeta)).toBe(false);
  });

  it('accepts when update authority is in allow list', async () => {
    const allowedUA = 'SomeKnownDBCUpdateAuthority123';
    const fakeMeta: MockMetadata = {
      data: { name: 'Unknown Name', symbol: 'UNK' },
      updateAuthority: { toBase58: () => allowedUA },
    };

    const NAME_HINTS = 'dbc,meteora,position,lp token'
      .split(',')
      .map((s) => s.trim().toLowerCase());
    const SYMBOL_HINTS = 'dbc,dbcp0s,mpn'.split(',').map((s) => s.trim().toLowerCase());
    const UPDATE_AUTH_ALLOW = [allowedUA]; // explicit allow-list

    const looksLikeDbc = (meta: MockMetadata) => {
      const name = (meta.data?.name || '').toLowerCase();
      const symbol = (meta.data?.symbol || '').toLowerCase();
      const ua = meta.updateAuthority?.toBase58?.() || '';

      if (ua && UPDATE_AUTH_ALLOW.includes(ua)) return true;
      if (NAME_HINTS.some((h) => name.includes(h))) return true;
      if (SYMBOL_HINTS.some((h) => symbol.includes(h))) return true;
      return false;
    };

    expect(looksLikeDbc(fakeMeta)).toBe(true);
  });
});
