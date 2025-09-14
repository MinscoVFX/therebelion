import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

// Centralized Studio runtime loader to avoid dynamic expression-based requires scattered in API routes.
// This reduces webpack "Critical dependency" warnings by constraining resolution to a known static map.

const requireNode = createRequire(import.meta.url);

let studioBaseDir: string | null = null;
function resolveStudioBase(): string | null {
  if (studioBaseDir) return studioBaseDir;
  try {
    const pkgPath = requireNode.resolve('@meteora-invent/studio/package.json');
    studioBaseDir = path.dirname(pkgPath);
    return studioBaseDir;
  } catch {
    return null;
  }
}

const MODULE_MAP: Record<string, string> = {
  damm_v2: 'dist/lib/damm_v2/index.js',
  dbc: 'dist/lib/dbc/index.js',
};

function loadModule(key: keyof typeof MODULE_MAP): any | null {
  const base = resolveStudioBase();
  if (!base) return null;
  const rel = MODULE_MAP[key];
  const target = path.join(base, rel);
  if (!fs.existsSync(target)) return null;
  try {
    return requireNode(target);
  } catch {
    return null;
  }
}

export function getDammV2Runtime() {
  return loadModule('damm_v2');
}
export function getDbcRuntime() {
  return loadModule('dbc');
}

export function getRuntimeHealth() {
  const damm = !!getDammV2Runtime();
  const dbc = !!getDbcRuntime();
  return { damm_v2: damm, dbc };
}
