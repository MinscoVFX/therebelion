// Static optional imports allow bundler to see concrete specifiers, avoiding critical dependency warnings.
// If package or subpath missing, we catch and return null.
let dammCache: any | undefined;
let dbcCache: any | undefined;

export async function getDammV2Runtime() {
  if (dammCache !== undefined) return dammCache;
  try {
    const studio = await import('@meteora-invent/studio');
    dammCache = studio.damm_v2;
  } catch {
    dammCache = null;
  }
  return dammCache;
}
export async function getDbcRuntime() {
  if (dbcCache !== undefined) return dbcCache;
  try {
    const studio = await import('@meteora-invent/studio');
    dbcCache = studio.dbc;
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
