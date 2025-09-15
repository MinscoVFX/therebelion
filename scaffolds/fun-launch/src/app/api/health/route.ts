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

  // RPC endpoint requirement (any alias acceptable)
  const rpcCandidates = ['RPC_ENDPOINT', 'RPC_URL', 'NEXT_PUBLIC_RPC_URL'];
  const rpcKey = rpcCandidates.find(k => process.env[k]);
  const hasFlags: Record<string, boolean> = {
    HAS_RPC_ENDPOINT: Boolean(process.env.RPC_ENDPOINT),
    HAS_RPC_URL: Boolean(process.env.RPC_URL),
    HAS_NEXT_PUBLIC_RPC_URL: Boolean(process.env.NEXT_PUBLIC_RPC_URL)
  };
  const details: Record<string, any> = { ...hasFlags };
  if (!rpcKey) {
    errors.push(`Missing RPC endpoint (set one of: ${rpcCandidates.join(', ')})`);
  } else {
    details['RPC_SELECTED'] = rpcKey;
  }

  // In production treat any warning as failure (status 500) for strictness
  const strictOk = errors.length === 0 && (process.env.NODE_ENV !== 'production' || warnings.length === 0);
  return { ok: strictOk, warnings, errors, details };
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
