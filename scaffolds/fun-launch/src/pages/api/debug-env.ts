import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    hasVar: !!process.env.POOL_CONFIG_KEY,
    len: process.env.POOL_CONFIG_KEY?.length ?? null,
    sample: process.env.POOL_CONFIG_KEY?.slice(0, 4) ?? null,
  });
}
