import type { NextApiRequest, NextApiResponse } from 'next';
import { loadDbcIdl, getClaimIxNameFromIdl } from '@/lib/dbc/idl';

export const runtime = 'nodejs';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    RPC_ENDPOINT: !!process.env.RPC_ENDPOINT,
    NEXT_PUBLIC_RPC_URL: !!process.env.NEXT_PUBLIC_RPC_URL,
    POOL_CONFIG_KEY: process.env.POOL_CONFIG_KEY,
    DBC_USE_IDL: process.env.DBC_USE_IDL,
    DBC_CLAIM_FEE_INSTRUCTION_NAME: process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME,
    DBC_CLAIM_FEE_DISCRIMINATOR: process.env.DBC_CLAIM_FEE_DISCRIMINATOR,
  } as const;

  const idl = process.env.DBC_USE_IDL === 'true' ? loadDbcIdl() : null;
  const ixName = idl ? getClaimIxNameFromIdl(idl) : null;
  const discriminatorSource = (() => {
    if (process.env.DBC_CLAIM_FEE_DISCRIMINATOR?.length === 16) return 'env_hex';
    if (process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME) return 'env_name';
    if (idl && ixName) return 'idl_' + ixName;
    return null;
  })();

  const warnings: string[] = [];
  if (!process.env.POOL_CONFIG_KEY) warnings.push('POOL_CONFIG_KEY missing');
  if (!process.env.RPC_ENDPOINT && !process.env.NEXT_PUBLIC_RPC_URL) warnings.push('No RPC configured');
  if (!discriminatorSource) warnings.push('No real DBC claim discriminator available; prod will be blocked');

  const ok = warnings.length === 0;
  res.status(ok ? 200 : 500).json({
    ok,
    env,
    idlLoaded: !!idl,
    claimIxFromIdl: ixName || null,
    discriminatorSource,
    warnings,
  });
}
