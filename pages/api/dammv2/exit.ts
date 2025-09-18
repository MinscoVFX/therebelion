import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey } from '@solana/web3.js';
import { universalExit } from '../../../src/lib/meteora/universalExit';

// Example: POST /api/dammv2/exit { owner, poolKeys, priorityMicros }
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { owner, poolKeys, priorityMicros } = req.body;
    if (!owner || !poolKeys) {
      return res.status(400).json({ error: 'owner and poolKeys required' });
    }
    const connection = new Connection(
      process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    // For backend, load keypair from env or file (replace with your keypair logic)
    // Example: const ownerKeypair = Keypair.fromSecretKey(...)
    // For demo, use PublicKey only (cannot sign/send tx)
    const ownerPk = new PublicKey(owner);
    // Validate poolKeys shape
    const keys = {
      programId: new PublicKey(poolKeys.programId),
      pool: new PublicKey(poolKeys.pool),
      lpMint: new PublicKey(poolKeys.lpMint),
      tokenAMint: new PublicKey(poolKeys.tokenAMint),
      tokenBMint: new PublicKey(poolKeys.tokenBMint),
      tokenAVault: new PublicKey(poolKeys.tokenAVault),
      tokenBVault: new PublicKey(poolKeys.tokenBVault),
      authorityPda: new PublicKey(poolKeys.authorityPda),
    };
    // Call universalExit logic
    const result = await universalExit({
      connection,
      owner: ownerPk,
      poolKeys: keys,
      priorityMicros: priorityMicros || 250_000,
    });
    return res.status(200).json({ success: true, result });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
  }
}
