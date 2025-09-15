import { VersionedTransaction } from '@solana/web3.js';

export interface UniversalExitTask {
  protocol: 'dbc' | 'dammv2';
  kind: 'claim' | 'withdraw';
  pool?: string; // common identifier
  feeVault?: string; // dbc
  position?: string; // damm v2 position nft
  tx: string; // base64 serialized versioned transaction
  lastValidBlockHeight: number;
}

export interface PlanOptions {
  owner: string;
  priorityMicros?: number;
  computeUnitLimit?: number; // reserved (only used in dbc path currently)
  include?: { dbc?: boolean; dammv2?: boolean };
}

// Small helper to POST JSON and parse (throws on !ok) with empty-body safety.
async function postJson<T = any>(url: string, body: any): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    // Attempt to read text (may be empty) for diagnostics
    const maybeText = await resp.text().catch(() => '');
    throw new Error(`${url} failed: ${resp.status}${maybeText ? ` body:${maybeText.slice(0,200)}` : ''}`);
  }
  // Some serverless platforms can yield empty 200 responses under race conditions; guard against that.
  const text = await resp.text();
  if (!text) {
    return {} as unknown as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Failed to parse JSON from ${url}: ${(e as any)?.message}`);
  }
}

export async function planUniversalExits(opts: PlanOptions): Promise<UniversalExitTask[]> {
  const tasks: UniversalExitTask[] = [];
  const { owner, priorityMicros, computeUnitLimit } = opts;
  const includeDbc = opts.include?.dbc !== false; // default true
  const includeDamm = opts.include?.dammv2 !== false; // default true

  if (includeDbc) {
    try {
      const discover = await postJson<{ positions?: any[] }>('/api/dbc-discover', { owner });
      const dbcPositions = discover.positions || [];
      // Build all DBC claim txs concurrently to reduce wall-clock time.
      const dbcBuilds = await Promise.allSettled(
        dbcPositions.map(p => (
          postJson<{ tx: string; lastValidBlockHeight: number }>('/api/dbc-exit', {
            owner,
            dbcPoolKeys: { pool: p.pool, feeVault: p.feeVault },
            action: 'claim',
            priorityMicros,
            computeUnitLimit,
          }).then(built => ({ p, built }))
        ))
      );
      for (const res of dbcBuilds) {
        if (res.status === 'fulfilled') {
          const { p, built } = res.value as any;
          tasks.push({
            protocol: 'dbc',
            kind: 'claim',
            pool: p.pool,
            feeVault: p.feeVault,
            tx: built.tx,
            lastValidBlockHeight: built.lastValidBlockHeight,
          });
        } else {
          // eslint-disable-next-line no-console
            console.warn('[universal-exit] skip dbc position build failure', res.reason?.message || res.reason);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[universal-exit] dbc discovery failed', (e as any)?.message);
    }
  }

  if (includeDamm) {
    try {
      const discover = await postJson<{ positions?: any[] }>('/api/dammv2-discover', { owner });
      const dammPositions = discover.positions || [];
      const dammBuilds = await Promise.allSettled(
        dammPositions.filter(p => p.pool).map(p => (
          postJson<{ tx: string; lastValidBlockHeight: number }>('/api/dammv2-exit', {
            owner,
            pool: p.pool,
            position: p.position,
            percent: 100,
            priorityMicros,
          }).then(built => ({ p, built }))
        ))
      );
      for (const res of dammBuilds) {
        if (res.status === 'fulfilled') {
          const { p, built } = res.value as any;
          tasks.push({
            protocol: 'dammv2',
            kind: 'withdraw',
            pool: p.pool,
            position: p.position,
            tx: built.tx,
            lastValidBlockHeight: built.lastValidBlockHeight,
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn('[universal-exit] skip dammv2 position build failure', res.reason?.message || res.reason);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[universal-exit] dammv2 discovery failed', (e as any)?.message);
    }
  }

  return tasks;
}

// Quick validator for base64 versioned transactions (throws if invalid)
export function validateSerializedTx(base64: string): void {
  try {
    VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  } catch (e) {
    throw new Error('Invalid serialized transaction: ' + (e as any)?.message);
  }
}
