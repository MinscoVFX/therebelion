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
  if (!hasAnyRpc) warnings.push('NO_RPC');
  if (!dbcUseIdl) warnings.push('DBC_USE_IDL_FALSE');
  if (!poolKey) warnings.push('MISSING_POOL_CONFIG_KEY');

  const fatal = !hasAnyRpc; // only missing RPC is fatal
  res.status(fatal ? 500 : 200).json({
    ok: !fatal,
    hasEndpoint,
    hasUrl,
    hasNextPub,
    dbcUseIdl,
    poolKeyPresent: !!poolKey,
    warnings,
  });
}
