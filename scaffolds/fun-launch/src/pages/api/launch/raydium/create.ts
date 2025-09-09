// scaffolds/fun-launch/src/pages/api/launch/raydium/create.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Data =
  | { ok: true }
  | { error: string; code?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Placeholder until Raydium SDK wiring is completed.
  res.status(501).json({
    error: 'Raydium LaunchLab not wired yet. Adapter is ready; implementation comes next.',
    code: 'RAYDIUM_NOT_WIRED',
  });
}
