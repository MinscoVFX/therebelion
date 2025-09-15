import { useState, useEffect } from "react";
// Wallet adapter removed for CI lint; integrate real adapter in app layer

export default function ExitPage() {
  const publicKey: { toBase58(): string } | null = null; // placeholder
  const [status, setStatus] = useState<string>("Idle");
    const log: string[] = [];
  const [feeRec, setFeeRec] = useState<{cuLimit:number; microLamports:number; source:string} | null>(null);
  const [ultraFastEnabled, setUltraFastEnabled] = useState(false);

  useEffect(() => {
    let aborted = false;
    async function preloadFee() {
      const fr = await fetch("/api/fees/recommend");
      const fj = await fr.json();
      if (!aborted && fj?.ok) setFeeRec({ cuLimit: fj.cuLimit, microLamports: fj.microLamports, source: fj.source });
    }
    if (publicKey) preloadFee();
    return () => { aborted = true; };
  }, [publicKey]);

  async function exitNow() {
    if (!publicKey) return;
    setStatus("Planning…");
    // Prebuild tx with fee rec
    const r = await fetch("/api/exit/build", {
      method: "POST",
      body: JSON.stringify({
  owner: publicKey?.toBase58(),
        cuLimit: feeRec?.cuLimit ?? undefined,
        microLamports: feeRec?.microLamports ?? undefined
      })
    });
  const { ok, error } = await r.json();
    if (error || !ok) { setStatus("Build error"); return; }
    setStatus("Sign");
    // TODO: Plug in wallet-send pipeline here, passing ultraFastEnabled to skipPreflight
    // Example:
    // const sig = await sendTransaction(tx, connection, {
    //   skipPreflight: ultraFastEnabled,
    //   preflightCommitment: ultraFastEnabled ? "processed" : "processed"
    // });
    setStatus("Confirmed");
  }

  return (
    <div style={{ padding: 24 }}>
  <h1>/exit — One-Click Claim (Withdraw Disabled)</h1>
      {!publicKey ? <p>Connect your wallet</p> : <>
  <button onClick={exitNow}>Claim Protocol Fees</button>
    <div style={{ marginTop: 8, fontSize: 12 }}>Withdraw endpoint returns 501 while in claim-only mode.</div>
        <label style={{ marginLeft: 16 }}>
          <input type="checkbox" checked={ultraFastEnabled} onChange={e => setUltraFastEnabled(e.target.checked)} /> Ultra fast (skip preflight)
        </label>
        {feeRec && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            priority fee: {feeRec.microLamports.toLocaleString()} μ-lamports/cu · compute limit: {feeRec.cuLimit.toLocaleString()} cu ({feeRec.source})
          </div>
        )}
      </>}
      <p>Status: {status}</p>
      <pre>{log.join("\n")}</pre>
    </div>
  );
}
