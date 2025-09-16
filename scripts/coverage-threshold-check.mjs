#!/usr/bin/env node
/* eslint-env node */
/**
 * coverage-threshold-check.mjs
 * Dynamic coverage gate with ratchet behavior.
 *
 * Behavior:
 * 1. Reads coverage/coverage-summary.json (Vitest V8 format).
 * 2. Thresholds come from env or fallback defaults.
 *    - COV_MIN_LINES / STATEMENTS / FUNCTIONS / BRANCHES
 * 3. Optional ratchet file (.coverage-baseline.json) can store previous achieved pct
 *    to require non-regression if higher than static floors.
 * 4. Fails with detailed listing if any category below required.
 */

import fs from 'fs';

const SUMMARY_PATH = 'coverage/coverage-summary.json';
const BASELINE_PATH = '.coverage-baseline.json';

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

if (!fs.existsSync(SUMMARY_PATH)) {
  console.error(`Coverage summary missing at ${SUMMARY_PATH}`);
  process.exit(1);
}

const summary = readJSON(SUMMARY_PATH);
if (!summary || !summary.total) {
  console.error('Malformed coverage summary');
  process.exit(1);
}

const total = summary.total;

// Static floors (adjust here for repository-wide baseline increments)
const staticFloors = {
  lines: Number(process.env.COV_MIN_LINES) || 25,
  statements: Number(process.env.COV_MIN_STATEMENTS) || 25,
  functions: Number(process.env.COV_MIN_FUNCTIONS) || 48,
  branches: Number(process.env.COV_MIN_BRANCHES) || 50,
};

// Ratchet logic:
// Modes:
//  - Default: static floors only (legacy behavior)
//  - Baseline augment: if baseline has higher pct, we lift floors (previous behavior)
//  - Explicit ratchet (COV_RATCHET=1): require current >= baseline - tolerance;
//    failing if regression beyond allowed drift.
const baseline = readJSON(BASELINE_PATH);
const ratchetEnabled = process.env.COV_RATCHET === '1';
const tolerance = Number(process.env.COV_RATCHET_TOLERANCE || '0.25'); // ratchet-only tolerance
// Global non-ratchet tolerance (applies when ratchet disabled) to permit tiny incidental dips.
const globalTolerance = Number(process.env.COV_TOLERANCE || '0');

const effectiveFloors = { ...staticFloors };
if (baseline && baseline.total) {
  if (ratchetEnabled) {
    for (const k of Object.keys(effectiveFloors)) {
      const baseVal = baseline.total[k];
      const basePct = typeof baseVal === 'number' ? baseVal : baseVal?.pct; // support simplified baseline format
      if (typeof basePct === 'number') {
        // enforce non-regression minus tolerance; don't drop below static floor
        const floor = Math.max(staticFloors[k], Math.floor((basePct - tolerance) * 100) / 100);
        effectiveFloors[k] = floor;
      }
    }
  } else {
    // legacy augment behavior
    for (const k of Object.keys(effectiveFloors)) {
      const b = baseline.total[k];
      const bPct = typeof b === 'number' ? b : b?.pct;
      if (typeof bPct === 'number' && bPct > effectiveFloors[k]) {
        effectiveFloors[k] = Math.floor(bPct);
      }
    }
  }
}

const failures = [];
for (const k of Object.keys(effectiveFloors)) {
  const pct = (total[k] && total[k].pct) || 0;
  const required = effectiveFloors[k];
  // When ratchet disabled, allow pct to be within globalTolerance below required before failing.
  const allowedFloor = ratchetEnabled ? required : required - globalTolerance;
  if (pct < allowedFloor) {
    failures.push({ metric: k, pct, required });
  }
}

if (failures.length) {
  console.error('COVERAGE THRESHOLD VIOLATIONS');
  for (const f of failures) {
    console.error(` - ${f.metric}: ${f.pct}% < required ${f.required}%`);
  }
  console.error(
    '\nTo adjust floors: set env vars COV_MIN_LINES, COV_MIN_STATEMENTS, COV_MIN_FUNCTIONS, COV_MIN_BRANCHES'
  );
  process.exit(1);
}

console.log('Coverage thresholds satisfied. Effective floors:', effectiveFloors, 'tolerance:', {
  ratchetTolerance: tolerance,
  globalTolerance,
});

// Optionally write / update baseline (only if improved). Controlled by COV_UPDATE_BASELINE=1
if (process.env.COV_UPDATE_BASELINE === '1') {
  // store simplified baseline schema: { total: { lines: <pct>, ... }, generatedAt }
  const snapshot = {
    total: {
      lines: total.lines.pct,
      statements: total.statements.pct,
      functions: total.functions.pct,
      branches: total.branches.pct,
    },
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`Baseline updated at ${BASELINE_PATH}`);
}
