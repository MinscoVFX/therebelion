import type { NextApiRequest, NextApiResponse } from 'next';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { buildDbcExitTransaction } from '../../../scaffolds/fun-launch/src/server/dbc-exit-builder'; // DBC path
import {
  buildDammV2RemoveAllLpIxs,
  type DammV2PoolKeys,
} from '../../../scaffolds/fun-launch/src/server/dammv2-adapter';

type Protocol = 'dbc' | 'dammv2';

interface ExitBuildBody {
  cuLimit?: number;
  microLamports?: number;
  owner?: string;
  dbcPoolKeys?: { pool: string; feeVault: string };
  action?: 'claim' | 'withdraw' | 'claim_and_withdraw';
  simulateOnly?: boolean;
  // New: DAMM v2 support
  protocol?: Protocol; // defaults to 'dbc' for backward compatibility
  dammV2PoolKeys?: {
    programId: string;
    pool: string;
    lpMint: string;
    tokenAMint: string;
    tokenBMint: string;
    tokenAVault: string;
    tokenBVault: string;
    authorityPda: string;
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const parsed: ExitBuildBody = (() => {
      try {
        return JSON.parse(req.body || '{}');
      } catch {
        return {};
      }
    })();
    const { cuLimit: bodyCu, microLamports: bodyFee } = parsed;
    let cuLimit = Number(bodyCu);
    let microLamports = Number(bodyFee);
    if (!Number.isFinite(cuLimit) || !Number.isFinite(microLamports)) {
      try {
        const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host}`;
        const r = await fetch(`${baseUrl}/api/fees/recommend`);
        const j = await r.json();
        cuLimit = Number.isFinite(Number(j?.cuLimit)) ? Number(j.cuLimit) : 600_000;
        microLamports = Number.isFinite(Number(j?.microLamports)) ? Number(j.microLamports) : 5_000;
      } catch {
        cuLimit = 600_000;
        microLamports = 5_000;
      }
    }
    // Build ComputeBudget instructions
    const computeBudgetIxs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ];
    // Build exit transaction depending on protocol
    let exitTxBase64: string | undefined;
    let simulation: { logs: string[]; unitsConsumed: number; error?: unknown } | undefined;

    const protocol: Protocol = (parsed.protocol as Protocol) || 'dbc';

    const rpc =
      process.env.TEST_MOCK_RPC === 'mock'
        ? 'mock'
        : process.env.RPC_URL ||
          process.env.RPC_ENDPOINT ||
          process.env.NEXT_PUBLIC_RPC_URL ||
          'https://api.mainnet-beta.solana.com';

    // Shared mock connection for tests
    const mockConnection = {
      getAccountInfo: async () => ({ data: Buffer.alloc(165, 1) }),
      getLatestBlockhash: async () => ({
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 123,
      }),
      simulateTransaction: async () => ({ value: { logs: [], unitsConsumed: 5000 } }),
      // For DAMM v2 adapter
      getTokenAccountBalance: async () => ({ value: { amount: '1000000000' } }),
    } as unknown as Connection;

    const connection = rpc === 'mock' ? mockConnection : new Connection(rpc, 'confirmed');

    try {
      if (protocol === 'dammv2') {
        if (!parsed.owner) throw new Error('owner required for dammv2');
        const k = parsed.dammV2PoolKeys;
        if (!k)
          throw new Error(
            'dammV2PoolKeys required: { programId, pool, lpMint, tokenAMint, tokenBMint, tokenAVault, tokenBVault, authorityPda }'
          );

        const poolKeys: DammV2PoolKeys = {
          programId: new PublicKey(k.programId),
          pool: new PublicKey(k.pool),
          lpMint: new PublicKey(k.lpMint),
          tokenAMint: new PublicKey(k.tokenAMint),
          tokenBMint: new PublicKey(k.tokenBMint),
          tokenAVault: new PublicKey(k.tokenAVault),
          tokenBVault: new PublicKey(k.tokenBVault),
          authorityPda: new PublicKey(k.authorityPda),
        };

        const owner = new PublicKey(parsed.owner);

        // Compose full instruction list
        const dammIxs = await buildDammV2RemoveAllLpIxs({
          connection,
          owner,
          poolKeys,
          priorityMicros: microLamports,
        });

        // Prepend compute budget limit if provided
        const ixs = [...computeBudgetIxs, ...dammIxs];

        const { blockhash } = await connection.getLatestBlockhash(
          'confirmed'
        );
        const msg = new TransactionMessage({
          payerKey: owner,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();
        const tx = new VersionedTransaction(msg);

        if (parsed.simulateOnly ?? true) {
          const sim = await connection.simulateTransaction(tx, {
            commitment: 'confirmed',
            sigVerify: false,
          });
          simulation = {
            logs: sim.value.logs || [],
            unitsConsumed: sim.value.unitsConsumed || 0,
            error: sim.value.err || undefined,
          };
        }
        exitTxBase64 = Buffer.from(tx.serialize()).toString('base64');
      } else {
        // Default: DBC path (backward compatible)
        if (parsed.owner && parsed.dbcPoolKeys?.pool && parsed.dbcPoolKeys?.feeVault) {
          const built = await buildDbcExitTransaction(connection, {
            owner: parsed.owner,
            dbcPoolKeys: parsed.dbcPoolKeys,
            action: parsed.action || 'claim',
            simulateOnly: parsed.simulateOnly ?? true,
            computeUnitLimit: cuLimit,
            priorityMicros: microLamports,
          });
          simulation = built.simulation;
          exitTxBase64 = Buffer.from(built.tx.serialize()).toString('base64');
        }
      }
    } catch (e) {
      return res.status(400).json({
        ok: false,
        cuLimit,
        microLamports,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    res.status(200).json({ ok: true, computeBudgetIxs, cuLimit, microLamports, exitTxBase64, simulation });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: err });
  }
}
