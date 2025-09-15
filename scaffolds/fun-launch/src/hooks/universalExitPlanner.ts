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

// Small helper to POST JSON and parse (throws on !ok)
async function postJson<T = any>(url: string, body: any): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`${url} failed: ${resp.status}`);
  return (await resp.json()) as T;
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
      for (const p of dbcPositions) {
        try {
          const built = await postJson<{ tx: string; lastValidBlockHeight: number }>('/api/dbc-exit', {
            owner,
            dbcPoolKeys: { pool: p.pool, feeVault: p.feeVault },
            action: 'claim',
            priorityMicros,
            computeUnitLimit,
          });
          tasks.push({
            protocol: 'dbc',
            kind: 'claim',
            pool: p.pool,
            feeVault: p.feeVault,
            tx: built.tx,
            lastValidBlockHeight: built.lastValidBlockHeight,
          });
        } catch (e) {
          // skip failing position; continue others
          // eslint-disable-next-line no-console
          console.warn('[universal-exit] skip dbc position build failure', (e as any)?.message);
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
      for (const p of dammPositions) {
        if (!p.pool) continue;
        try {
          const built = await postJson<{ tx: string; lastValidBlockHeight: number }>('/api/dammv2-exit', {
            owner,
            pool: p.pool,
            position: p.position,
            percent: 100,
            priorityMicros,
          });
          tasks.push({
            protocol: 'dammv2',
            kind: 'withdraw',
            pool: p.pool,
            position: p.position,
            tx: built.tx,
            lastValidBlockHeight: built.lastValidBlockHeight,
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[universal-exit] skip dammv2 position build failure', (e as any)?.message);
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
