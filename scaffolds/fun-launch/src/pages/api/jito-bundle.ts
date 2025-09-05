import type { NextApiRequest, NextApiResponse } from "next";

type Region = "ny" | "amsterdam" | "frankfurt" | "tokyo" | "mainnet";
const REGION: Region = (process.env.JITO_BLOCK_ENGINE_REGION as Region) || "ny";

const BUNDLE_URL: Record<Region, string> = {
  ny: "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  amsterdam: "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  frankfurt: "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  tokyo: "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
  mainnet: "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
};
const STATUS_URL: Record<Region, string> = {
  ny: "https://ny.mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses",
  amsterdam: "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses",
  frankfurt: "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses",
  tokyo: "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses",
  mainnet: "https://mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses",
};
const TIP_ACCOUNTS_URL: Record<Region, string> = {
  ny: "https://ny.mainnet.block-engine.jito.wtf/api/v1/getTipAccounts",
  amsterdam: "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/getTipAccounts",
  frankfurt: "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/getTipAccounts",
  tokyo: "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/getTipAccounts",
  mainnet: "https://mainnet.block-engine.jito.wtf/api/v1/getTipAccounts",
};

async function jitoRpc(url: string, method: string, params: any[]) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  const body = await r.json();
  if (body?.error) throw new Error(body.error?.message ?? "Jito RPC error");
  return body.result;
}

async function pollStatus(region: Region, bundleId: string, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const arr = await jitoRpc(STATUS_URL[region], "getBundleStatuses", [[bundleId]]);
    const s = Array.isArray(arr) ? arr[0]?.status : undefined;
    if (s === "Landed" || s === "Failed") return s;
    await new Promise((r) => setTimeout(r, 600));
  }
  return "TimedOut";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // GET ?tipAccounts=1  -> list tip accounts
    if (req.method === "GET" && req.query.tipAccounts) {
      const tipAccounts = await jitoRpc(TIP_ACCOUNTS_URL[REGION], "getTipAccounts", []);
      return res.status(200).json({ region: REGION, tipAccounts });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body ?? {};
    const txs: unknown = body.txs;
    const waitForLanded = !!body.waitForLanded;

    if (!Array.isArray(txs) || txs.length < 1 || txs.length > 5)
      return res.status(400).json({ error: "txs must be 1–5 base64 signed transactions" });
    if (!txs.every((t) => typeof t === "string" && t.length > 0))
      return res.status(400).json({ error: "txs elements must be non-empty base64 strings" });

    const bundleId: string = await jitoRpc(BUNDLE_URL[REGION], "sendBundle", [txs]); // tip required! :contentReference[oaicite:1]{index=1}

    let status: string | undefined;
    if (waitForLanded) {
      try { status = await pollStatus(REGION, bundleId); } catch (e: any) { status = `StatusPollError: ${e?.message}`; }
    }
    return res.status(200).json({ ok: true, bundleId, region: REGION, status });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Unknown error" });
  }
}
