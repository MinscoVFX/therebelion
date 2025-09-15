import {
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { loadDbcIdlIfAvailable } from './dbc-idl-utils';

/**
 * Centralized DBC fee-claim / (future) liquidity exit builder.
 * This currently performs a fee claim instruction using a configurable discriminator.
 * Real integration should swap the placeholder discriminator with the official one
 * or preferably call the Meteora SDK runtime builder when available.
 */

export interface DbcPoolKeysInput {
  pool: string; // base58
  feeVault: string; // base58 (SPL token account accumulating fees)
}

export type DbcExitAction = 'claim' | 'withdraw';

export interface BuildExitArgs {
  owner: string; // wallet pubkey
  dbcPoolKeys: DbcPoolKeysInput;
  action?: DbcExitAction; // default 'claim'
  priorityMicros?: number;
  slippageBps?: number; // reserved / future use for withdraw quoting
  computeUnitLimit?: number;
  simulateOnly?: boolean;
}

export interface BuiltExitTx {
  tx: VersionedTransaction;
  lastValidBlockHeight: number;
  simulation?: {
    logs: string[];
    unitsConsumed: number;
    error?: any;
  };
}

// Resolve program + discriminator via env to avoid hard-coding incorrect constants.
// Provide sane defaults while still allowing override.
const DEFAULT_DBC_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const PROGRAM_ID = new PublicKey(process.env.DBC_PROGRAM_ID || DEFAULT_DBC_PROGRAM);
// Optional allow list: comma-separated program IDs considered valid for safety.
const ALLOWED: string[] = (process.env.ALLOWED_DBC_PROGRAM_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
function assertProgramAllowed(pk: PublicKey) {
  if (ALLOWED.length === 0) return; // no allow list configured
  if (!ALLOWED.includes(pk.toBase58())) {
    throw new Error(`DBC program ${pk.toBase58()} not in ALLOWED_DBC_PROGRAM_IDS`);
  }
}
// 8-byte little-endian placeholder; MUST be overridden with real discriminator for production.
let _placeholderWarned = false;
function resolveClaimDiscriminator(): Buffer {
  // If IDL usage enabled, attempt to derive from IDL (choose creator or partner claim).
  if (process.env.DBC_USE_IDL === 'true') {
    const idl = loadDbcIdlIfAvailable();
    if (idl) {
      // Prefer partner fee claim then creator claim as generic 'claim'.
      const preferred = idl.instructions.find((i: any) => i.name === 'claim_partner_trading_fee') ||
        idl.instructions.find((i: any) => i.name === 'claim_creator_trading_fee');
      if (preferred) {
        return preferred.discriminator;
      }
    }
  }
  const raw = process.env.DBC_CLAIM_FEE_DISCRIMINATOR || '0102030405060708';
  const hex = raw.replace(/^0x/, '');
  if (hex.length !== 16) throw new Error('DBC_CLAIM_FEE_DISCRIMINATOR must be 8 bytes (16 hex chars)');
  if (hex === '0102030405060708' && !_placeholderWarned && process.env.DBC_SUPPRESS_PLACEHOLDER_WARNING !== 'true') {
    _placeholderWarned = true;
    // eslint-disable-next-line no-console
    console.warn('[dbc-exit-builder] Using placeholder DBC_CLAIM_FEE_DISCRIMINATOR. Replace with real 8-byte discriminator from Meteora DBC docs or supply IDL.');
  }
  return Buffer.from(hex, 'hex');
}
const CLAIM_FEE_DISCRIMINATOR = resolveClaimDiscriminator();

export function isUsingPlaceholderDiscriminator(): boolean {
  return (process.env.DBC_CLAIM_FEE_DISCRIMINATOR || '0102030405060708') === '0102030405060708';
}

function buildClaimInstruction(pool: PublicKey, feeVault: PublicKey, owner: PublicKey, userTokenAccount: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(8);
  CLAIM_FEE_DISCRIMINATOR.copy(data); // direct copy
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: feeVault, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Placeholder withdraw instruction builder.
 * Real DBC liquidity withdrawal likely requires:
 *  - Pool account (writable)
 *  - Position / LP account or NFT representation
 *  - Token vaults (A/B) & user destination token accounts
 *  - Additional config / oracle / authority accounts (per DBC spec)
 *  - Distinct 8-byte discriminator for withdraw / close / burn logic
 * Without official IDL / SDK we cannot craft a correct instruction.
 * We surface an explicit error so callers know this path is not yet wired.
 */
function buildWithdrawPlaceholderInstruction(): never {
  let extra = '';
  if (process.env.DBC_USE_IDL === 'true') {
    const idl = loadDbcIdlIfAvailable();
    if (idl) {
      const withdrawIx = idl.instructions.find((i: any) => /withdraw/i.test(i.name));
      if (withdrawIx) {
        extra = ` (IDL detected instruction '${withdrawIx.name}' accounts: ${withdrawIx.accounts.join(', ')})`;
      }
    }
  }
  throw new Error(
    'DBC withdraw (liquidity removal) is not implemented yet.' +
      ' Provide official DBC withdraw spec / SDK to enable.' + extra
  );
}

export async function buildDbcExitTransaction(
  connection: Connection,
  args: BuildExitArgs
): Promise<BuiltExitTx> {
  if (process.env.NODE_ENV === 'production' && isUsingPlaceholderDiscriminator() && process.env.ALLOW_PLACEHOLDER_DBC !== 'true') {
    throw new Error('DBC placeholder discriminator in production. Set DBC_CLAIM_FEE_DISCRIMINATOR (8-byte hex) or ALLOW_PLACEHOLDER_DBC=true to override.');
  }
  // Validate basics
  if (!args.owner) throw new Error('owner required');
  if (!args.dbcPoolKeys?.pool || !args.dbcPoolKeys?.feeVault) throw new Error('dbcPoolKeys.pool & feeVault required');
  const action: DbcExitAction = args.action || 'claim';
  assertProgramAllowed(PROGRAM_ID);

  const priorityMicros = Math.max(0, Math.min(args.priorityMicros ?? 250_000, 3_000_000));
  const computeUnitLimit = args.computeUnitLimit
    ? Math.max(50_000, Math.min(args.computeUnitLimit, 1_400_000))
    : undefined;

  const ownerPk = new PublicKey(args.owner);
  const pool = new PublicKey(args.dbcPoolKeys.pool);
  const feeVault = new PublicKey(args.dbcPoolKeys.feeVault);

  const feeVaultInfo = await connection.getAccountInfo(feeVault);
  if (!feeVaultInfo) throw new Error('Fee vault not found');
  if (feeVaultInfo.data.length < 64) throw new Error('Fee vault data too small for SPL token account');

  // Extract mint and owner from token account (SPL account layout):
  // mint: [0..32), owner: [32..64)
  const tokenMint = new PublicKey(feeVaultInfo.data.slice(0, 32));
  // const tokenAccountOwner = new PublicKey(feeVaultInfo.data.slice(32, 64)); // reserved for future authority checks
  // optional sanity: fee vault owner should be pool or program authority (skip strict check for now)

  const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, ownerPk, false);

  const instructions: TransactionInstruction[] = [];
  if (priorityMicros > 0) {
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicros }));
  }
  if (computeUnitLimit) {
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }));
  }

  // Ensure destination ATA exists idempotently
  instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(ownerPk, userTokenAccount, ownerPk, tokenMint)
  );

  if (action === 'claim') {
    // Claim fees instruction
    instructions.push(buildClaimInstruction(pool, feeVault, ownerPk, userTokenAccount));
  } else if (action === 'withdraw') {
    // Attempt to build withdraw instructions (currently placeholder -> throw)
    buildWithdrawPlaceholderInstruction();
  } else {
    throw new Error(`Unsupported DBC exit action: ${action}`);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: ownerPk, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  if (args.simulateOnly) {
    const sim = await connection.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: false });
    return {
      tx,
      lastValidBlockHeight,
      simulation: {
        logs: sim.value.logs || [],
        unitsConsumed: sim.value.unitsConsumed || 0,
        error: sim.value.err || undefined,
      },
    };
  }

  return { tx, lastValidBlockHeight };
}
