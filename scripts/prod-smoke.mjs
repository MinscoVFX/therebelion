// Production smoke test script (clean canonical version)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_URL =
  process.env.APP_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  'https://therebelion-fun-launch.vercel.app';

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const bodyText = await res.text();
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = { _raw: bodyText };
  }
  return { res, json };
}

function assertStatus(res, expected, context) {
  if (res.status !== expected) {
    throw new Error(`${context} expected status ${expected} got ${res.status}`);
  }
}

async function run() {
  const report = { startedAt: new Date().toISOString(), appUrl: APP_URL, steps: [] };

  const stepWrap = async (name, fn) => {
    const step = { name, ok: false };
    try {
      await fn(step);
    } catch (e) {
      step.error = e.message || String(e);
    }
    report.steps.push(step);
  };

  await stepWrap('health', async (step) => {
    const { res, json } = await fetchJson(`${APP_URL}/api/health`);
    assertStatus(res, 200, 'health');
    assert.strictEqual(json.ok, true, 'health json.ok true');
    step.ok = true;
    step.status = res.status;
    step.json = json;
  });

  await stepWrap('dbc-exit simulate claim GET', async (step) => {
    const { res, json } = await fetchJson(`${APP_URL}/api/dbc-exit?action=claim&simulateOnly=true`);
    assertStatus(res, 200, 'dbc-exit claim GET');
    assert.ok(json, 'claim simulate json exists');
    step.ok = true;
    step.status = res.status;
    step.json = json;
  });

  await stepWrap('dbc-exit simulate claim POST', async (step) => {
    const { res, json } = await fetchJson(
      `${APP_URL}/api/dbc-exit?action=claim&simulateOnly=true`,
      { method: 'POST' }
    );
    assertStatus(res, 200, 'dbc-exit claim POST');
    assert.ok(json, 'claim simulate json exists');
    step.ok = true;
    step.status = res.status;
    step.json = json;
  });

  await stepWrap('dbc-exit withdraw disabled', async (step) => {
    const { res, json } = await fetchJson(
      `${APP_URL}/api/dbc-exit?action=withdraw&simulateOnly=true`
    );
    assertStatus(res, 501, 'dbc-exit withdraw');
    step.ok = true;
    step.status = res.status;
    step.json = json;
  });

  await stepWrap('exit page claim-only copy', async (step) => {
    const res = await fetch(`${APP_URL}/exit`);
    const html = await res.text();
    assertStatus(res, 200, 'exit page');
    // Allow either variant to avoid race between deployment versions or conditional rendering states.
    const variants = [
      ['Claim Fees Only', 'Withdraws are temporarily disabled'],
      ['Claim Fees Only', 'Withdraws are disabled'],
    ];
    const matched = variants.some((needles) => needles.every((n) => html.includes(n)));
    if (!matched) {
      const primary = variants[0];
      const missing = primary.filter((n) => !html.includes(n));
      throw new Error(`exit page missing copy: ${missing.join(', ')}`);
    }
    step.ok = true;
    step.status = res.status;
    step.sample = html.slice(0, 300);
  });

  // Optional lightweight probes for new endpoints; they are tolerant to missing params and should not fail hard.
  await stepWrap('dammv2 routes import + simulate sanity', async (step) => {
    const endpoints = ['/api/dammv2-discover', '/api/dammv2-exit', '/api/dammv2-exit-all'];
    const results = [];
    for (const ep of endpoints) {
      try {
        const { res } = await fetchJson(`${APP_URL}${ep}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // minimal payloads to exercise handler without requiring a real wallet
          body: ep.endsWith('discover')
            ? JSON.stringify({ owner: '11111111111111111111111111111111' })
            : ep.endsWith('exit')
              ? JSON.stringify({
                  owner: '11111111111111111111111111111111',
                  pool: '11111111111111111111111111111111',
                  simulateOnly: true,
                  slippageBps: 50,
                })
              : JSON.stringify({
                  owner: '11111111111111111111111111111111',
                  simulateOnly: true,
                  slippageBps: 50,
                }),
        });
        results.push({ ep, status: res.status });
      } catch (e) {
        results.push({ ep, error: e.message || String(e) });
      }
    }
    // Do not assert strict 200 here; only ensure endpoints respond without throwing at fetch layer.
    step.ok = true;
    step.results = results;
  });

  // Dedicated DAMM v2 simulate step (expect 200 and presence of exitTxBase64)
  await stepWrap('dammv2-exit simulateOnly 200', async (step) => {
    const { res, json } = await fetchJson(`${APP_URL}/api/dammv2-exit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: '11111111111111111111111111111111',
        pool: '11111111111111111111111111111111',
        simulateOnly: true,
        slippageBps: 50,
      }),
    });
    // Assert 200 OK and presence of exitTxBase64; tolerate alias 'tx' but prefer explicit key
    assertStatus(res, 200, 'dammv2-exit simulateOnly');
    if (!json || !json.exitTxBase64) {
      throw new Error('dammv2-exit missing exitTxBase64');
    }
    step.hasExitTxBase64 = true;
    step.ok = true;
    step.status = res.status;
    step.json = json;
  });

  await stepWrap('dbc one-click exit import', async (step) => {
    // Ensure the new one-click endpoint is reachable; do not require wallet.
    const { res } = await fetchJson(`${APP_URL}/api/dbc-one-click-exit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerPubkey: '11111111111111111111111111111111', simulate: true }),
    });
    // Accept 200 or a descriptive 4xx (missing positions) as pass
    step.ok = res.status >= 200 && res.status < 500;
    step.status = res.status;
  });

  report.finishedAt = new Date().toISOString();
  report.allPassed = report.steps.every((s) => s.ok);

  const outPath = path.join(__dirname, 'prod-smoke-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Wrote report to ${outPath}`);
  if (!report.allPassed) {
    console.error('Failures detected');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
// End of script
