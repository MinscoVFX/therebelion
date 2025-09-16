// Static optional imports allow bundler to see concrete specifiers, avoiding critical dependency warnings.
// If package or subpath missing, we catch and return null.
let dammCache: any | undefined;
let dbcCache: any | undefined;
let studioModulePromise: Promise<any | null> | undefined;

async function loadStudioModule(): Promise<any | null> {
  if (studioModulePromise) return studioModulePromise;

  studioModulePromise = (async () => {
    const tried: string[] = [];
    let lastError: unknown;

    async function tryImport(specifier: string) {
      try {
        return await import(specifier);
      } catch (err) {
        tried.push(specifier);
        lastError = err;
        return null;
      }
    }

    // Preferred workspace package entry (built dist)
    let mod = await tryImport('@meteora-invent/studio');

    // Local dist build (when running from repo but without publishing step)
    if (!mod) {
      mod =
        (await tryImport('../../../../studio/dist/index.js')) ||
        (await tryImport('../../../../studio/dist/index.mjs'));
    }

    // Developer environments often skip the build entirely; fall back to source files.
    if (!mod && process.env.NODE_ENV !== 'production') {
      mod =
        (await tryImport('../../../../studio/src/index.ts')) ||
        (await tryImport('../../../../studio/src/index.js')) ||
        (await tryImport('../../../../studio/src/index'));
    }

    if (!mod) {
      const details = tried.join(', ');
      const suffix = lastError instanceof Error ? `: ${lastError.message}` : '';
      console.warn(
        `[studioRuntime] Unable to load @meteora-invent/studio runtime. Tried ${details}${suffix}`
      );
      return null;
    }

    return mod;
  })();

  return studioModulePromise;
}

export async function getDammV2Runtime() {
  if (dammCache !== undefined) return dammCache;
  const studio = await loadStudioModule();
  dammCache = studio?.damm_v2 ?? null;
  return dammCache;
}
export async function getDbcRuntime() {
  if (dbcCache !== undefined) return dbcCache;
  const studio = await loadStudioModule();
  dbcCache = studio?.dbc ?? null;
  return dbcCache;
}

export async function getRuntimeHealth() {
  const damm = !!(await getDammV2Runtime());
  const dbc = !!(await getDbcRuntime());
  return { damm_v2: damm, dbc };
}
