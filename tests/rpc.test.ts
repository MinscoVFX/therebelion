import { describe, it, expect } from 'vitest';
import { resolveRpc } from '../src/lib/rpc';

// Preserve original env
const ORIGINAL_ENV = { ...process.env };

describe('resolveRpc', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns RPC_ENDPOINT when set', () => {
    process.env.RPC_ENDPOINT = 'https://endpoint.example';
    delete process.env.RPC_URL;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    expect(resolveRpc()).toBe('https://endpoint.example');
  });

  it('falls back to RPC_URL then NEXT_PUBLIC_RPC_URL', () => {
    delete process.env.RPC_ENDPOINT;
    process.env.RPC_URL = 'https://rpcurl.example';
    process.env.NEXT_PUBLIC_RPC_URL = 'https://public.example';
    expect(resolveRpc()).toBe('https://rpcurl.example');
    delete process.env.RPC_URL;
    expect(resolveRpc()).toBe('https://public.example');
  });

  it('throws when none set', () => {
    delete process.env.RPC_ENDPOINT;
    delete process.env.RPC_URL;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    expect(() => resolveRpc()).toThrow(/RPC missing/);
  });
});
