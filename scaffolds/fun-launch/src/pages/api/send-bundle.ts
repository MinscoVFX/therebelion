// scaffolds/fun-launch/src/pages/api/dbc/send-bundle.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Forwards a client-signed bundle to a Jito/Sender relay.
 *
 * ENV REQUIRED:
 *   JITO_RELAY_URL = https://sender.helius-rpc.com/fast
 *
 * Request JSON:
 *   { "base58Bundle": ["<tx0_base58>", "<tx1_base58>", ...] }
 *
 * Response JSON:
 *   { "ok": true, "bundleId": "<id>" }
 */

const RELAY = (process.env.JITO_RELAY_URL || '').trim();

function bad(res: NextApiResponse, code: number, msg: string, extra?: Record<string, unknown>) {
  return res.status(code).json({ ok: false, error: msg, where: 'send-bundle', ...extra });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return bad(res, 405, 'Method Not Allowed');
    }
    if (!RELAY) return bad(res, 500, 'Missing JITO_RELAY_URL env');

    const { base58Bundle } = (req.body || {}) as { base58Bundle?: string[] };
    if (!Array.isArray(base58Bundle) || base58Bundle.length < 2) {
      return bad(res, 400, 'base58Bundle must be an array with at least 2 items (create, buy)');
    }
    if (!base58Bundle.every((s) => typeof s === 'string' && s.length > 0)) {
      return bad(res, 400, 'Every bundle entry must be a non-empty base58 string');
    }

    // JSON-RPC payload understood by Helius Sender/Jito relays.
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [base58Bundle],
    };

    const r = await fetch(RELAY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Try to parse JSON; if not JSON, capture text for diagnostics
    let json: any = null;
    try {
      json = await r.json();
    } catch {
      const text = await r.text();
      return bad(res, 502, 'Relay returned non-JSON', { relayText: text });
    }

    if (!r.ok || json?.error) {
      return bad(res, 502, 'sendBundle failed', { providerResponse: json });
    }

    // Some relays return { result: "<bundleId>" }, others may nest it differently
    const bundleId = json?.result ?? json?.bundleId ?? null;

    return res.status(200).json({ ok: true, bundleId });
  } catch (e: any) {
    return bad(res, 500, e?.message || 'Unexpected error');
  }
}
