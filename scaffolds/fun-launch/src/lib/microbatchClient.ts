// scaffolds/fun-launch/src/lib/microbatchClient.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Drop-in sender that:
 * - Queues tx server-side for ~0.18–0.22s so buys in that window confirm in the same slot
 * - Returns a signature once flushed
 * - Falls back to your current send path if the API/flag isn't enabled
 */

type WalletLike = {
  signTransaction: (tx: any) => Promise<any>;
  publicKey?: { toBase58: () => string };
};

type ConnectionLike = unknown; // kept for signature parity

function toBase64(u8: Uint8Array) {
  // Browser-safe base64 without new deps
  if (typeof window !== 'undefined' && typeof btoa !== 'undefined') {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  // Node/Vercel: global Buffer exists
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return Buffer.from(u8).toString('base64');
}

async function postJSON(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt || 'submit failed');
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error('invalid JSON');
  }
}

async function pollSignature(url: string, key: string, timeoutMs = 7000) {
  const start = Date.now();
  // simple long-poll loop
  // note: API returns {status:'pending'} until flushed, {signature} on success, or {error} on send failure
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await fetch(`${url}?id=${encodeURIComponent(key)}`);
    const txt = await r.text();
    let j: any = {};
    try { j = JSON.parse(txt); } catch { /* ignore */ }

    if (j?.signature) return j.signature as string;
    if (j?.error) throw new Error(String(j.error));

    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for signature');
    await new Promise((res) => setTimeout(res, 150));
  }
}

/**
 * sendTransactionSmart
 * - If NEXT_PUBLIC_MICROBATCH=1, routes via API micro-batcher
 * - Otherwise, uses provided fallback (your current sendTransaction path)
 */
export async function sendTransactionSmart(
  _connection: ConnectionLike,
  wallet: WalletLike,
  tx: any,
  fallback: (tx: any) => Promise<string> | Promise<any>,
): Promise<string> {
  const enabled = process.env.NEXT_PUBLIC_MICROBATCH === '1';
  const api = '/api/microbatch/submit';

  if (!enabled) {
    return (await fallback(tx)) as string;
  }

  try {
    const signed = await wallet.signTransaction(tx);
    const raw = signed.serialize() as Uint8Array;

    const key =
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto && (crypto as any).randomUUID()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await postJSON(api, { txBase64: toBase64(raw), key });
    const sig = await pollSignature(api, key, 7000);
    return sig;
  } catch {
    // graceful fallback if batching path fails for any reason
    return (await fallback(tx)) as string;
  }
}
