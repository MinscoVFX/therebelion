import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  buildDammV2RemoveAllLpIxs,
  DammV2PoolKeys,
} from '../../../scaffolds/fun-launch/src/server/dammv2-adapter';

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
    const ownerPk = new PublicKey(owner);
    // Validate poolKeys shape
    const keys: DammV2PoolKeys = {
      programId: new PublicKey(poolKeys.programId),
      pool: new PublicKey(poolKeys.pool),
      lpMint: new PublicKey(poolKeys.lpMint),
      tokenAMint: new PublicKey(poolKeys.tokenAMint),
      tokenBMint: new PublicKey(poolKeys.tokenBMint),
      tokenAVault: new PublicKey(poolKeys.tokenAVault),
      tokenBVault: new PublicKey(poolKeys.tokenBVault),
      authorityPda: new PublicKey(poolKeys.authorityPda),
    };
    // Build instructions
    const ixs = await buildDammV2RemoveAllLpIxs({
      connection,
      owner: ownerPk,
      poolKeys: keys,
      priorityMicros: priorityMicros || 250_000,
    });
    // For demo: return instruction count and first ix data
    return res
      .status(200)
      .json({
        success: true,
        instructionCount: ixs.length,
        firstIx: ixs[0]?.data?.toString('hex'),
      });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}
