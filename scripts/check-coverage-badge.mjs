#!/usr/bin/env node
/* eslint-env node */
import fs from 'fs';
import path from 'path';

function extractBadgePercent(readme) {
  const match = readme.match(/coverage-([0-9]+)%25/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

const root = process.cwd();
const coverageSummaryPath = path.join(root, 'coverage', 'coverage-summary.json');
if (!fs.existsSync(coverageSummaryPath)) {
  console.error('coverage-summary.json not found. Run coverage first.');
  process.exit(1);
}
const summary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
const linesPct = Math.round(summary.total.lines.pct);
const readmePath = path.join(root, 'README.md');
const readme = fs.readFileSync(readmePath, 'utf8');
const badgePct = extractBadgePercent(readme);
if (badgePct == null) {
  console.error('Coverage badge not found in README.md');
  process.exit(1);
}
const diff = Math.abs(linesPct - badgePct);
if (diff > 1) {
  console.error(`Coverage badge drift detected: badge=${badgePct}% actual=${linesPct}% (>1%)`);
  process.exit(1);
}
console.log(
  `Coverage badge within tolerance: badge=${badgePct}% actual=${linesPct}% (diff=${diff}%)`
);
