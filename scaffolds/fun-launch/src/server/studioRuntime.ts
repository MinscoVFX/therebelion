// Static optional imports allow bundler to see concrete specifiers, avoiding critical dependency warnings.
// If package or subpath missing, we catch and return null.
let dammCache: any | undefined;
let dbcCache: any | undefined;

export function getDammV2Runtime() {
  if (dammCache !== undefined) return dammCache;
  try {
    dammCache = require('@meteora-invent/studio/lib/damm_v2');
  } catch {
    dammCache = null;
  }
  return dammCache;
}
export function getDbcRuntime() {
  if (dbcCache !== undefined) return dbcCache;
  try {
    dbcCache = require('@meteora-invent/studio/lib/dbc');
  } catch {
    dbcCache = null;
  }
  return dbcCache;
}

export function getRuntimeHealth() {
  const damm = !!getDammV2Runtime();
  const dbc = !!getDbcRuntime();
  return { damm_v2: damm, dbc };
}
