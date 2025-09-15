#!/usr/bin/env node
/* eslint-env node */
import fs from 'fs';
import path from 'path';

const summaryPath = path.resolve('coverage/coverage-summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error('coverage-summary.json not found (run coverage first)');
  process.exit(1);
}
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const pct = Math.round(summary.total.lines.pct);
const badgeRegex = /(!\[Coverage\]\(https:\/\/img.shields.io\/badge\/coverage-)([^-]+)%25-(.*?\))/;
const readmePath = path.resolve('README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme.replace(badgeRegex, (_, pre, _old, post) => `${pre}${pct}%25-${post}`);
fs.writeFileSync(readmePath, readme);
console.log(`Updated coverage badge to ${pct}%`);
