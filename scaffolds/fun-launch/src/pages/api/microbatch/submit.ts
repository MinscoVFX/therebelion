import type { NextApiRequest, NextApiResponse } from 'next';

// In-memory queue + result map (per server instance)
type Pending = { txBase64: string; key: string; at: number };
const queue: Pending[] = [];
const results = new Map<string, { signature?: string; error?: string }>();
let scheduled = false;

const BASE_MS = 200;           // target queue window
const JITTER = 60;             // ±30ms
const rpcUrl =
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  ''; // no build error if unset; handled at runtime

function scheduleFlush() {
  if (scheduled) return;
  scheduled = true;
  const wait = BASE_MS + Math.floor(Math.random() * JITTER) - Math.floor(JITTER / 2);

  setTimeout(async () => {
    scheduled = false;
    const batch: Pending[] = queue.splice(0, queue.length);

    // Shuffle (simple Fisher–Yates without destructuring swap)
    for (let i = batch.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = batch[i] as Pending;  // definite assignment
      batch[i] = batch[j] as Pending;
      batch[j] = tmp;
    }

    // Fast sequential sends — typically land in the same slot
    for (const p of batch) {
      try {
        if (!rpcUrl) throw new Error('RPC_URL not configured');

        const body = {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [
            p.txBase64, // base64-encoded signed tx
            { skipPreflight: true, preflightCommitment: 'processed', maxRetries: 2 },
          ],
        };

        const r = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

        const j = await r.json();
        if (j?.error) throw new Error(j.error?.message || 'rpc error');
        results.set(p.key, { signature: j.result as string });
      } catch (e: unknown) {
        results.set(p.key, { error: (e as Error)?.message || 'send failed' });
      }
    }
  }, wait);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // POST -> queue a signed transaction
  if (req.method === 'POST') {
    const { txBase64, key } = (req.body || {}) as { txBase64?: string; key?: string };
    if (!txBase64 || !key) return res.status(400).json({ error: 'missing txBase64 or key' });
    queue.push({ txBase64, key, at: Date.now() });
    scheduleFlush();
    return res.status(200).json({ status: 'queued', key });
  }

  // GET ?id=... -> poll for signature
  if (req.method === 'GET') {
    const id = (req.query?.id as string) || '';
    if (!id) return res.status(400).json({ error: 'missing id' });
    const r = results.get(id);
    if (!r) return res.status(200).json({ status: 'pending' });
    return res.status(r.error ? 500 : 200).json(r.error ? { error: r.error } : { signature: r.signature });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '512kb' },
  },
};
