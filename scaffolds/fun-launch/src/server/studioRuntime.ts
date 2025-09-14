// Static optional imports allow bundler to see concrete specifiers, avoiding critical dependency warnings.
// If package or subpath missing, we catch and return null.
let dammCache: any | undefined;
let dbcCache: any | undefined;

export async function getDammV2Runtime() {
  if (dammCache !== undefined) return dammCache;
  try {
    dammCache = await import('@meteora-invent/studio/lib/damm_v2');
  } catch {
    dammCache = null;
  }
  return dammCache;
}
export async function getDbcRuntime() {
  if (dbcCache !== undefined) return dbcCache;
  try {
    dbcCache = await import('@meteora-invent/studio/lib/dbc');
  } catch {
    dbcCache = null;
  }
  return dbcCache;
}

export async function getRuntimeHealth() {
  const damm = !!(await getDammV2Runtime());
  const dbc = !!(await getDbcRuntime());
  return { damm_v2: damm, dbc };
}
