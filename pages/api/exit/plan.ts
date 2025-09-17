import type { NextApiRequest, NextApiResponse } from 'next';

// Minimal exit plan API stub
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ plan: null });
}
