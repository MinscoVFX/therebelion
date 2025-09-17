import { describe, it, expect } from 'vitest';
import { makeConnection } from '../src/lib/rpc';

describe('RPC utilities', () => {
  it('creates connection with default commitment', () => {
    // Set up RPC env for this test
    const originalRpc = process.env.RPC_ENDPOINT;
    process.env.RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
    
    try {
      const connection = makeConnection();
      expect(connection).toBeDefined();
      expect(connection.rpcEndpoint).toBe('https://api.mainnet-beta.solana.com');
      expect(connection.commitment).toBe('confirmed');
    } finally {
      // Restore environment
      if (originalRpc) {
        process.env.RPC_ENDPOINT = originalRpc;
      } else {
        delete process.env.RPC_ENDPOINT;
      }
    }
  });

  it('creates connection with custom commitment', () => {
    // Set up RPC env for this test
    const originalRpc = process.env.RPC_ENDPOINT;
    process.env.RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
    
    try {
      const connection = makeConnection('finalized');
      expect(connection).toBeDefined();
      expect(connection.commitment).toBe('finalized');
    } finally {
      // Restore environment
      if (originalRpc) {
        process.env.RPC_ENDPOINT = originalRpc;
      } else {
        delete process.env.RPC_ENDPOINT;
      }
    }
  });
});