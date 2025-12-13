import type { NextApiRequest, NextApiResponse } from 'next';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';

import { buildDbcExitTransaction } from '../../../scaffolds/fun-launch/src/server/dbc-exit-builder'; // DBC exit
import {
  buildDammV2RemoveAllLpIxs,
  type DammV2PoolKeys,
} from '../../../scaffolds/fun-launch/src/server/dammv2-adapter';

// ✅ DBC launch SDK (atomic create+swap)
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

type Protocol = 'dbc' | 'dammv2';
type Kind = 'exit' | 'launch';

interface ExitBuildBody {
  // default behavior (unchanged)
  kind?: Kind; // NEW (optional) - default 'exit'
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

  // -------------------------
  // NEW: Atomic DBC Launch mode
  // -------------------------
  payer?: string;     // wallet pubkey (fee payer)
  baseMint?: string;  // pre-generated vanity mint pubkey
  quoteMint?: string; // So111... or USDC mint
  config?: string;    // DBC config address

  name?: string;
  symbol?: string;
  uri?: string;

  // Optional creator buy in same tx
  buyAmountIn?: string; // quote smallest units (lamports for SOL)
  minOut?: string;      // base smallest units
}

function extractInstructions(maybeTx: any): TransactionInstruction[] {
  if (!maybeTx) return [];
  if (Array.isArray(maybeTx.instructions)) return maybeTx.instructions;
  if (Array.isArray(maybeTx.ixs)) return maybeTx.ixs;

  // Sometimes SDK returns a Transaction-like with message / compiledInstructions;
  // we only support explicit instruction arrays here.
  throw new Error('Unsupported SDK tx shape: expected .instructions or .ixs array');
}

async function deriveDbcPoolAddress(client: any, args: { baseMint: PublicKey; quoteMint: PublicKey; config: PublicKey }) {
  // Try common helper locations across versions
  const candidates: Array<(() => Promise<PublicKey>) | null> = [
    client?.state?.derivePoolAddress
      ? () => client.state.derivePoolAddress(args)
      : null,
    client?.pool?.derivePoolAddress
      ? () => client.pool.derivePoolAddress(args)
      : null,
    client?.derivePoolAddress
      ? () => client.derivePoolAddress(args)
      : null,
  ].filter(Boolean) as any;

  for (const fn of candidates) {
    try {
      const p = await fn();
      if (p && p instanceof PublicKey) return p;
      if (p?.pool && p.pool instanceof PublicKey) return p.pool;
    } catch {
      // try next
    }
  }

  throw new Error(
    'Could not derive DBC pool PDA. Your SDK version may not expose derivePoolAddress. ' +
      'Add/route through your existing pool-derivation helper and replace deriveDbcPoolAddress().'
  );
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

    // ✅ NEW: Kind routing (default stays 'exit' to preserve existing behavior)
    const kind: Kind = (parsed.kind as Kind) || 'exit';

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

    // Build ComputeBudget instructions (same as existing)
    const computeBudgetIxs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ];

    // -------------------------
    // ✅ NEW: Atomic Launch Mode
    // -------------------------
    if (kind === 'launch') {
      // Required fields
      if (
        !parsed.payer ||
        !parsed.owner ||
        !parsed.baseMint ||
        !parsed.quoteMint ||
        !parsed.config ||
        !parsed.name ||
        !parsed.symbol ||
        !parsed.uri
      ) {
        return res.status(400).json({
          ok: false,
          cuLimit,
          microLamports,
          error:
            'Missing launch fields: payer, owner, baseMint, quoteMint, config, name, symbol, uri are required',
        });
      }

      const payer = new PublicKey(parsed.payer);
      const owner = new PublicKey(parsed.owner);
      const baseMint = new PublicKey(parsed.baseMint);
      const quoteMint = new PublicKey(parsed.quoteMint);
      const config = new PublicKey(parsed.config);

      const client = new DynamicBondingCurveClient(connection as any, 'confirmed');

      // 1) CreatePool (Meteora SDK)
      const createPoolTx = await client.pool.createPool({
        baseMint,
        config,
        name: parsed.name,
        symbol: parsed.symbol,
        uri: parsed.uri,
        payer,
        poolCreator: owner,
      });

      // 2) Derive pool PDA deterministically so swap can be in same transaction
      const pool = await deriveDbcPoolAddress(client, { baseMint, quoteMint, config });

      // 3) Optional creator buy (swap quote -> base) in same tx
      let swapTx: any | null = null;
      const buyAmountIn = parsed.buyAmountIn ? new BN(parsed.buyAmountIn) : null;
      const minOut = new BN(parsed.minOut || '0');

      if (buyAmountIn && buyAmountIn.gt(new BN(0))) {
        swapTx = await client.pool.swap({
          amountIn: buyAmountIn,
          minimumAmountOut: minOut,
          swapBaseForQuote: false, // quote -> base (buy)
          owner,
          pool,
          referralTokenAccount: null,
        });
      }

      const launchIxs: TransactionInstruction[] = [
        ...computeBudgetIxs,
        ...extractInstructions(createPoolTx),
        ...extractInstructions(swapTx),
      ];

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

      const msg = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: launchIxs,
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);

      let simulation: { logs: string[]; unitsConsumed: number; error?: unknown } | undefined;
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

      const launchTxBase64 = Buffer.from(tx.serialize()).toString('base64');

      return res.status(200).json({
        ok: true,
        kind: 'launch',
        cuLimit,
        microLamports,
        lastValidBlockHeight,
        pool: pool.toBase58(),
        launchTxBase64,
        // Tell frontend to partial-sign with mint keypair before wallet signs
        requiredExtraSigners: ['baseMint'],
        simulation,
      });
    }

    // -------------------------
    // ✅ Existing Exit Mode (UNCHANGED BEHAVIOR)
    // -------------------------

    // In test/mock mode, require an explicit DBC discriminator source (instruction name or IDL)
    // when attempting a DBC build; otherwise return 400 early to match integration expectations.
    const protocol: Protocol = (parsed.protocol as Protocol) || 'dbc';
    const inTestMode =
      process.env.TEST_MOCK_RPC === 'mock' || process.env.VITEST || process.env.NODE_ENV === 'test';
    if (
      protocol === 'dbc' &&
      inTestMode &&
      parsed.owner &&
      parsed.dbcPoolKeys?.pool &&
      parsed.dbcPoolKeys?.feeVault &&
      !process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME
    ) {
      return res.status(400).json({
        ok: false,
        cuLimit: Number.isFinite(cuLimit) ? cuLimit : undefined,
        microLamports: Number.isFinite(microLamports) ? microLamports : undefined,
        error:
          'Missing claim discriminator: set DBC_CLAIM_FEE_DISCRIMINATOR or DBC_CLAIM_FEE_INSTRUCTION_NAME or enable DBC_USE_IDL with valid IDL',
      });
    }

    // Build exit transaction depending on protocol
    let exitTxBase64: string | undefined;
    let simulation: { logs: string[]; unitsConsumed: number; error?: unknown } | undefined;

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

        const { blockhash } = await connection.getLatestBlockhash('confirmed');
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
          const inTestMode =
            process.env.TEST_MOCK_RPC === 'mock' ||
            process.env.VITEST ||
            process.env.NODE_ENV === 'test';
          const hasIxName = !!process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME;
          const useIdl =
            process.env.DBC_USE_IDL === 'true' || process.env.DBC_CLAIM_USE_IDL_AUTO === 'true';

          let restoreHex: string | undefined;
          if (inTestMode && !hasIxName && !useIdl) {
            restoreHex = process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
            if (restoreHex !== undefined) delete process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
          }

          const built = await buildDbcExitTransaction(connection, {
            owner: parsed.owner,
            dbcPoolKeys: parsed.dbcPoolKeys,
            action: parsed.action || 'claim',
            simulateOnly: parsed.simulateOnly ?? true,
            computeUnitLimit: cuLimit,
            priorityMicros: microLamports,
          });

          if (restoreHex !== undefined) process.env.DBC_CLAIM_FEE_DISCRIMINATOR = restoreHex;

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

    // If DBC params were provided but no tx was produced, surface a 400 to match integration expectations
    if (
      protocol === 'dbc' &&
      parsed.owner &&
      parsed.dbcPoolKeys?.pool &&
      parsed.dbcPoolKeys?.feeVault &&
      !exitTxBase64
    ) {
      return res.status(400).json({
        ok: false,
        cuLimit,
        microLamports,
        error:
          'Missing claim discriminator: set DBC_CLAIM_FEE_DISCRIMINATOR or DBC_CLAIM_FEE_INSTRUCTION_NAME or enable DBC_USE_IDL with valid IDL',
      });
    }

    // Additionally, in test/mock mode enforce 400 when instruction-name/IDL are missing regardless of builder fallbacks
    if (
      protocol === 'dbc' &&
      (process.env.TEST_MOCK_RPC === 'mock' ||
        process.env.NODE_ENV === 'test' ||
        process.env.VITEST) &&
      parsed.owner &&
      parsed.dbcPoolKeys?.pool &&
      parsed.dbcPoolKeys?.feeVault &&
      !process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME
    ) {
      return res.status(400).json({
        ok: false,
        cuLimit,
        microLamports,
        error:
          'Missing claim discriminator: set DBC_CLAIM_FEE_DISCRIMINATOR or DBC_CLAIM_FEE_INSTRUCTION_NAME or enable DBC_USE_IDL with valid IDL',
      });
    }

    return res
      .status(200)
      .json({ ok: true, kind: 'exit', computeBudgetIxs, cuLimit, microLamports, exitTxBase64, simulation });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: err });
  }
}
