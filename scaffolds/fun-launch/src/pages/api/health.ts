import type { NextApiRequest, NextApiResponse } from 'next';
export const runtime = 'nodejs';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const hasEndpoint = !!process.env.RPC_ENDPOINT;
  const hasUrl = !!process.env.RPC_URL;
  const hasNextPub = !!process.env.NEXT_PUBLIC_RPC_URL;
  const hasAnyRpc = hasEndpoint || hasUrl || hasNextPub;
  const dbcUseIdl = process.env.DBC_USE_IDL === 'true';
  const poolKey = process.env.POOL_CONFIG_KEY;

  const warnings: string[] = [];
  if (!hasAnyRpc) warnings.push('No RPC configured (RPC_ENDPOINT/RPC_URL/NEXT_PUBLIC_RPC_URL)');
  if (!dbcUseIdl) warnings.push('DBC_USE_IDL should be true for prod');
  if (!poolKey) warnings.push('POOL_CONFIG_KEY missing');

  const ok = warnings.length === 0;
  res.status(ok ? 200 : 500).json({
    ok,
    hasEndpoint,
    hasUrl,
    hasNextPub,
    dbcUseIdl,
    poolKeyPresent: !!poolKey,
    warnings,
  });
}
