// Relocated from scaffolds/fun-launch/src/server/studioRuntime.ts
let dammCache: any | undefined;
let dbcCache: any | undefined;

export async function getDammV2Runtime() {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return null;
  }
  if (dammCache !== undefined) return dammCache;
  try {
    const spec = '@meteora-invent/studio';
    const studio = await import(spec);
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
    const studio = await import(spec);
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
