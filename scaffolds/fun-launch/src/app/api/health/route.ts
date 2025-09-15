import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'node:child_process';

// Lightweight cached git commit retrieval
function getGitCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

interface EnvCheckResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
  details: Record<string, any>;
}

function checkEnv(): EnvCheckResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Discriminator placeholder check
  const placeholder = (process.env.DBC_CLAIM_FEE_DISCRIMINATOR || '0102030405060708') === '0102030405060708';
  if (placeholder && process.env.NODE_ENV === 'production' && process.env.ALLOW_PLACEHOLDER_DBC !== 'true') {
    errors.push('Placeholder DBC_CLAIM_FEE_DISCRIMINATOR in production');
  } else if (placeholder) {
    warnings.push('Using placeholder DBC_CLAIM_FEE_DISCRIMINATOR');
  }

  // Allow list format validation
  const allowRaw = process.env.ALLOWED_DBC_PROGRAM_IDS || '';
  if (allowRaw) {
    const entries = allowRaw.split(',').map(s => s.trim()).filter(Boolean);
    for (const id of entries) {
      if (!/^\w{32,44}$/.test(id)) {
        warnings.push(`Possibly invalid program id in ALLOWED_DBC_PROGRAM_IDS: ${id}`);
      }
    }
  }

  // Basic required envs (expandable)
  const required: string[] = ['RPC_ENDPOINT'];
  const details: Record<string, any> = {};
  for (const key of required) {
    const val = process.env[key];
    if (!val) errors.push(`Missing required env: ${key}`);
    details[key] = val ? 'present' : 'missing';
  }

  return { ok: errors.length === 0, warnings, errors, details: { ...details } };
}

export async function GET(_req: NextRequest) {
  const env = checkEnv();
  const body = {
    service: 'fun-launch',
    time: new Date().toISOString(),
    commit: getGitCommit(),
    env,
  };
  const status = env.ok ? 200 : 500;
  return NextResponse.json(body, { status });
}
