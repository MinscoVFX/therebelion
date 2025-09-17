#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'fs';

function readJSON(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const baseline = readJSON('.coverage-baseline.json');
const summary = readJSON('coverage/coverage-summary.json');
if (!summary || !baseline) {
  console.log('Coverage delta: missing summary or baseline');
  process.exit(0);
}

const metrics = ['lines', 'statements', 'functions', 'branches'];
const rows = [];
let regression = false;
for (const m of metrics) {
  const b = baseline[m];
  const cur = summary.total[m];
  if (!b || !cur) continue;
  const basePct = typeof b === 'number' ? b : (b.pct ?? b);
  const curPct = cur.pct;
  const delta = (curPct - basePct).toFixed(2);
  if (curPct + 1e-6 < basePct) regression = true;
  rows.push({ metric: m, base: basePct, current: curPct, delta });
}

const out = [];
out.push('| Metric | Baseline % | Current % | Δ |');
out.push('|--------|-----------:|----------:|---:|');
for (const r of rows) {
  out.push(`| ${r.metric} | ${r.base} | ${r.current} | ${r.delta} |`);
}

console.log(out.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    '\n### Coverage Delta\n' + out.join('\n') + '\n'
  );
}
if (regression) {
  console.error('Coverage regression detected (delta below baseline).');
  // Do NOT exit non-zero here; coverage-threshold-check.mjs enforces policy.
}
