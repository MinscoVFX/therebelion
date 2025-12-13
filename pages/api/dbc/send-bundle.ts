// pages/api/dbc/send-bundle.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Body = { base58Bundle: string[] };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, where: 'api/dbc/send-bundle', error: 'POST only' });
    }

    const parsed: Body = (() => {
      try {
        return JSON.parse(req.body || '{}');
      } catch {
        return {} as any;
      }
    })();

    const base58Bundle = parsed.base58Bundle;
    if (!Array.isArray(base58Bundle) || base58Bundle.length < 1 || base58Bundle.length > 5) {
      return res.status(400).json({
        ok: false,
        where: 'api/dbc/send-bundle',
        error: 'base58Bundle must be an array of 1..5 base58-encoded signed transactions',
      });
    }

    // ✅ Jito block engine endpoint (default mainnet).
    // You can override with env var.
    const endpoint =
      process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [base58Bundle],
    };

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => null as any);

    if (!r.ok || !j) {
      return res.status(502).json({
        ok: false,
        where: 'api/dbc/send-bundle',
        error: `Block engine HTTP ${r.status}`,
        providerResponse: j ?? null,
      });
    }

    if (j.error) {
      return res.status(400).json({
        ok: false,
        where: 'api/dbc/send-bundle',
        error: j.error?.message || 'sendBundle error',
        providerResponse: j,
      });
    }

    return res.status(200).json({ ok: true, bundleId: j.result });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      where: 'api/dbc/send-bundle',
      error: String(e?.message || e),
    });
  }
}
