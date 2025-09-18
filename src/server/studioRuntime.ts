// Static optional imports allow bundler to see concrete specifiers, avoiding critical dependency warnings.
// If package or subpath missing, we catch and return null.
let dammCache: unknown | undefined;
let dbcCache: unknown | undefined;

export async function getDammV2Runtime() {
  // In unit tests, avoid resolving the Studio package altogether
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return null;
  }
  if (dammCache !== undefined) return dammCache;
  try {
    // Hint bundlers not to pre-resolve this specifier during tests/builds
    const spec = '@meteora-invent/studio';
    // @vite-ignore
    const studio = await import(/* @vite-ignore */ spec);
    dammCache = studio.damm_v2;
  } catch {
    dammCache = null;
  }
  return dammCache;
}
export async function getDbcRuntime() {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return null;
  }
  if (dbcCache !== undefined) return dbcCache;
  try {
    const spec = '@meteora-invent/studio';
    // @vite-ignore
    const studio = await import(/* @vite-ignore */ spec);
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
