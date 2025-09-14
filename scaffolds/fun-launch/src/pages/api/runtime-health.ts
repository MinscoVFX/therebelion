import type { NextApiRequest, NextApiResponse } from 'next';
import { getRuntimeHealth } from '@/server/studioRuntime';

export const dynamic = 'force-dynamic';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const health = getRuntimeHealth();
  return res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    runtimes: health,
  });
}
