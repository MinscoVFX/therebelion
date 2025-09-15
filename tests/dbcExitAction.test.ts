/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { buildDbcExitTransaction } from '../scaffolds/fun-launch/src/server/dbc-exit-builder';
import { Connection, Keypair } from '@solana/web3.js';

// Use a public RPC that should be stable for basic blockhash fetch, fallback to mainnet.
// Create a lightweight mockable connection by extending real Connection but stubbing getAccountInfo.
class MockConnection extends Connection {
  async getAccountInfo() {
    // Return minimal SPL token account-like buffer (at least 64 bytes) with dummy mint/owner.
    const data = Buffer.alloc(165); // standard token account size
    // leave zeros; builder slices mint(0..32) and owner(32..64)
    return { data, executable: false, lamports: 1, owner: Keypair.generate().publicKey, rentEpoch: 0 } as any;
  }
}
const connection = new MockConnection(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

// NOTE: This test only validates builder branching logic & immediate errors; it doesn't sign or send.

describe('DBC exit builder action handling', () => {
  const owner = Keypair.generate().publicKey.toBase58();
  // Dummy keys (they won't be fetched for claim beyond feeVault account info; skip withdraw due to placeholder)
  // For claim path we need a real-like fee vault account to avoid network fetch failure; we simulate by expecting an error earlier for withdraw.
  const dummyPool = Keypair.generate().publicKey.toBase58();
  const dummyFeeVault = Keypair.generate().publicKey.toBase58();

  it('throws for unsupported action', async () => {
    await expect(
      buildDbcExitTransaction(connection, {
        owner,
        dbcPoolKeys: { pool: dummyPool, feeVault: dummyFeeVault },
        // @ts-expect-error intentionally wrong
        action: 'nope',
        simulateOnly: true,
      })
    ).rejects.toThrow(/Unsupported DBC exit action/);
  });

  it('errors for withdraw placeholder action', async () => {
    await expect(
      buildDbcExitTransaction(connection, {
        owner,
        dbcPoolKeys: { pool: dummyPool, feeVault: dummyFeeVault },
        action: 'withdraw',
        simulateOnly: true,
      })
    ).rejects.toThrow(/not implemented/i);
  });
});
