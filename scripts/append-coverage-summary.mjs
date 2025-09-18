#!/usr/bin/env node
/* eslint-env node */
// Prints a markdown table of coverage totals to stdout. Safe for shell redirection.
import fs from 'fs';

const SUMMARY_PATH = 'coverage/coverage-summary.json';

if (!fs.existsSync(SUMMARY_PATH)) {
  console.log('No coverage summary found.');
  process.exit(0);
}

try {
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
  const total = summary?.total || {};
  const order = ['lines', 'statements', 'functions', 'branches'];
  console.log('| Metric | % | Covered/Total |');
  console.log('|--------|---|---------------|');
  for (const k of order) {
    const m = total[k];
    if (!m) continue;
    const pct = typeof m.pct === 'number' ? m.pct : 0;
    const covered = typeof m.covered === 'number' ? m.covered : 0;
    const totalVal = typeof m.total === 'number' ? m.total : 0;
    console.log('| ' + k + ' | ' + pct + ' | ' + covered + '/' + totalVal + ' |');
  }
} catch (e) {
  console.error('Failed to read coverage summary:', e?.message || e);
  process.exit(1);
}
