// scaffolds/fun-launch/src/pages/api/dbc/health.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const rpc = (process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || '').trim();
  const relay = (process.env.JITO_RELAY_URL || '').trim();
  const r2 = Boolean(
    process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET
  );
  const cfg = Boolean(process.env.POOL_CONFIG_KEY);

  return res.status(200).json({
    ok: true,
    rpcConfigured: Boolean(rpc),
    relayConfigured: Boolean(relay),
    r2Configured: r2,
    poolConfigConfigured: cfg,
    tips: [
      'RPC_URL or NEXT_PUBLIC_RPC_URL must be set',
      'JITO_RELAY_URL should be https://sender.helius-rpc.com/fast (server-only)',
      'R2_* and R2_PUBLIC_BASE required for image/metadata upload',
      'POOL_CONFIG_KEY must be a valid Meteora DBC config pubkey',
    ],
  });
}
