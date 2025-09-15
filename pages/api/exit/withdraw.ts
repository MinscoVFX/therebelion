import type { NextApiRequest, NextApiResponse } from 'next';

// Explicitly disabled: claim-only mode. Returns 501 to signal not implemented.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(501).json({ ok: false, error: 'Withdraw disabled: launchpad is in claim-only mode' });
}
