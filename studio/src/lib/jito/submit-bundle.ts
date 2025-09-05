// scaffolds/fun-launch/src/lib/jito/submit-bundle.ts

export type JitoBundleResult = {
  bundleId: string;
  status?: "Landed" | "Failed" | "TimedOut" | string;
  region?: string;
};

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Submit 1–5 base64-encoded, fully-signed transactions as a Jito bundle.
 * Your /api/jito-bundle route talks to the Block Engine.
 *
 * @param signedTxBase64s Ordered list of signed txs, e.g. [createPool, devBuy]
 * @param waitForLanded   If true, server polls briefly for Landed/Failed
 */
export async function submitJitoBundle(
  signedTxBase64s: string[],
  waitForLanded = true
): Promise<JitoBundleResult> {
  if (!Array.isArray(signedTxBase64s) || signedTxBase64s.length === 0) {
    throw new Error("submitJitoBundle: pass 1–5 base64 signed transactions");
  }

  const res = await fetch("/api/jito-bundle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txs: signedTxBase64s, waitForLanded }),
  });

  if (!res.ok) {
    const body = await readJson(res);
    const msg = (body as any)?.error || (body as any)?.message || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }

  const body = (await readJson(res)) as any;
  if (!body?.bundleId) throw new Error("submitJitoBundle: missing bundleId in response");

  return {
    bundleId: body.bundleId,
    status: body.status,
    region: body.region,
  };
}

/**
 * Get Jito tip accounts (region comes from server env).
 * Use one pubkey as the recipient of a small SystemProgram.transfer tip.
 */
export async function getTipAccounts(): Promise<string[]> {
  const res = await fetch("/api/jito-bundle?tipAccounts=1", { method: "GET" });
  if (!res.ok) throw new Error(`getTipAccounts failed: HTTP ${res.status}`);
  const body = (await readJson(res)) as any;
  const list = body?.tipAccounts;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("No tip accounts returned");
  }
  return list as string[];
}

// Optional default export if you prefer `import submit from '.../submit-bundle'`
export default { submitJitoBundle, getTipAccounts };
