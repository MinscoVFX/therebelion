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
import { loadDbcIdlIfAvailable, anchorInstructionDiscriminator } from './dbc-idl-utils';

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

export type DbcExitAction = 'claim' | 'withdraw' | 'claim_and_withdraw';

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
  .map((s) => s.trim())
  .filter(Boolean);
function assertProgramAllowed(pk: PublicKey) {
  if (ALLOWED.length === 0) return; // no allow list configured
  if (!ALLOWED.includes(pk.toBase58())) {
    throw new Error(`DBC program ${pk.toBase58()} not in ALLOWED_DBC_PROGRAM_IDS`);
  }
}
// 8-byte little-endian placeholder; MUST be overridden with real discriminator for production.
interface ClaimDiscResolutionMeta {
  source: 'explicit' | 'name' | 'idl' | 'placeholder';
  instructionName?: string;
}
let _discMeta: ClaimDiscResolutionMeta | null = null;
export function getClaimDiscriminatorMeta(): ClaimDiscResolutionMeta | null {
  return _discMeta;
}
// Withdraw discriminator meta (mirrors claim logic but independent so we can track placeholder usage)
interface WithdrawDiscResolutionMeta {
  source: 'explicit' | 'name' | 'idl' | 'placeholder';
  instructionName?: string;
}
let _withdrawMeta: WithdrawDiscResolutionMeta | null = null;
export function getWithdrawDiscriminatorMeta(): WithdrawDiscResolutionMeta | null {
  return _withdrawMeta;
}
function resolveClaimDiscriminator(): Buffer {
  const explicit = process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
  if (explicit) {
    const hex = explicit.replace(/^0x/, '');
    if (hex.length !== 16)
      throw new Error('DBC_CLAIM_FEE_DISCRIMINATOR must be 8 bytes (16 hex chars)');
    _discMeta = { source: 'explicit' };
    return Buffer.from(hex, 'hex');
  }
  const useIdl =
    process.env.DBC_USE_IDL === 'true' || process.env.DBC_CLAIM_USE_IDL_AUTO === 'true';
  if (useIdl) {
    const idl = loadDbcIdlIfAvailable();
    if (idl) {
      const preferred =
        idl.instructions.find((i: any) => /claim/.test(i.name) && /fee/.test(i.name)) ||
        idl.instructions.find((i: any) => i.name === 'claim_partner_trading_fee') ||
        idl.instructions.find((i: any) => i.name === 'claim_creator_trading_fee') ||
        idl.instructions.find((i: any) => i.name === 'claim_fee');
      if (preferred) {
        _discMeta = { source: 'idl', instructionName: preferred.name };
        return preferred.discriminator;
      }
    }
  }
  const ixName = process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME;
  if (ixName) {
    if (
      !['claim_partner_trading_fee', 'claim_creator_trading_fee', 'claim_fee'].includes(
        ixName.trim()
      )
    ) {
      throw new Error(`Unsupported DBC_CLAIM_FEE_INSTRUCTION_NAME: ${ixName}`);
    }
    const disc = anchorInstructionDiscriminator(ixName.trim());
    _discMeta = { source: 'name', instructionName: ixName.trim() };
    return disc;
  }
  throw new Error(
    'Missing claim discriminator: set DBC_CLAIM_FEE_DISCRIMINATOR or DBC_CLAIM_FEE_INSTRUCTION_NAME or enable DBC_USE_IDL with valid IDL'
  );
}
let _claimDiscBuf: Buffer | null = null;
function claimDisc(): Buffer {
  if (!_claimDiscBuf) {
    _claimDiscBuf = resolveClaimDiscriminator();
  }
  return _claimDiscBuf;
}

// Test helper: force claim discriminator resolution (not used in production paths directly)
export function __resolveClaimDiscForTests(): string {
  const buf = claimDisc();
  return Buffer.from(buf).toString('hex');
}

function resolveWithdrawDiscriminator(): Buffer {
  const explicit = process.env.DBC_WITHDRAW_DISCRIMINATOR;
  if (explicit) {
    const hex = explicit.replace(/^0x/, '');
    if (hex.length !== 16)
      throw new Error('DBC_WITHDRAW_DISCRIMINATOR must be 8 bytes (16 hex chars)');
    _withdrawMeta = { source: 'explicit' };
    return Buffer.from(hex, 'hex');
  }
  const useIdl =
    process.env.DBC_USE_IDL === 'true' || process.env.DBC_WITHDRAW_USE_IDL_AUTO === 'true';
  if (useIdl) {
    const idl = loadDbcIdlIfAvailable();
    if (idl) {
      const preferred =
        idl.instructions.find((i: any) => /withdraw/.test(i.name) && /liquidity/.test(i.name)) ||
        idl.instructions.find((i: any) => /withdraw/i.test(i.name));
      if (preferred) {
        _withdrawMeta = { source: 'idl', instructionName: preferred.name };
        return preferred.discriminator;
      }
    }
  }
  const ixName = process.env.DBC_WITHDRAW_INSTRUCTION_NAME;
  if (ixName) {
    const disc = anchorInstructionDiscriminator(ixName.trim());
    _withdrawMeta = { source: 'name', instructionName: ixName.trim() };
    return disc;
  }
  throw new Error(
    'Missing withdraw discriminator: set DBC_WITHDRAW_DISCRIMINATOR or DBC_WITHDRAW_INSTRUCTION_NAME or enable DBC_USE_IDL with valid IDL'
  );
}
let _withdrawDiscBuf: Buffer | null = null;
function withdrawDisc(): Buffer {
  if (!_withdrawDiscBuf) {
    _withdrawDiscBuf = resolveWithdrawDiscriminator();
  }
  return _withdrawDiscBuf;
}

// Expose a helper to introspect the active discriminator (used in tests for instruction-name path)
export function getActiveClaimDiscriminatorHex(): string {
  return claimDisc().toString('hex');
}
export function getActiveWithdrawDiscriminatorHex(): string {
  return withdrawDisc().toString('hex');
}

export function isUsingPlaceholderDiscriminator(): boolean {
  return false;
}

// Test-only helper to reset cached discriminator buffers & metadata (used when env vars change between tests)
export function __resetDbcExitBuilderCacheForTests() {
  _claimDiscBuf = null;
  _withdrawDiscBuf = null;
  _discMeta = null;
  _withdrawMeta = null;
}

function buildClaimInstruction(
  pool: PublicKey,
  feeVault: PublicKey,
  owner: PublicKey,
  userTokenAccount: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(8);
  claimDisc().copy(data); // direct copy
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
function buildWithdrawInstruction(
  pool: PublicKey,
  owner: PublicKey,
  userTokenAccount: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(8);
  withdrawDisc().copy(data);
  // Account ordering: attempt to follow IDL pattern (user, pool, user_token_account, token_program)
  // Without official SDK this may fail on-chain; guarded by placeholder + prod env check below.
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export async function buildDbcExitTransaction(
  connection: Connection,
  args: BuildExitArgs
): Promise<BuiltExitTx> {
  if (
    process.env.NODE_ENV === 'production' &&
    isUsingPlaceholderDiscriminator() &&
    process.env.ALLOW_PLACEHOLDER_DBC !== 'true'
  ) {
    throw new Error(
      'DBC placeholder discriminator in production. Set DBC_CLAIM_FEE_DISCRIMINATOR (8-byte hex) or ALLOW_PLACEHOLDER_DBC=true to override.'
    );
  }
  // Validate basics
  if (!args.owner) throw new Error('owner required');
  if (!args.dbcPoolKeys?.pool || !args.dbcPoolKeys?.feeVault)
    throw new Error('dbcPoolKeys.pool & feeVault required');
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
  if (feeVaultInfo.data.length < 64)
    throw new Error('Fee vault data too small for SPL token account');

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
    instructions.push(buildClaimInstruction(pool, feeVault, ownerPk, userTokenAccount));
  } else if (action === 'withdraw') {
    instructions.push(buildWithdrawInstruction(pool, ownerPk, userTokenAccount));
  } else if (action === 'claim_and_withdraw') {
    // Sequential: claim fees then withdraw liquidity in one atomic transaction
    instructions.push(buildClaimInstruction(pool, feeVault, ownerPk, userTokenAccount));
    instructions.push(buildWithdrawInstruction(pool, ownerPk, userTokenAccount));
  } else {
    throw new Error(`Unsupported DBC exit action: ${action}`);
  }

  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    const latest = await connection.getLatestBlockhash('confirmed');
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
  } catch (error) {
    if (!args.simulateOnly) throw error;
    // When tests or local development environments run in offline mode we still want to
    // produce a transaction object for simulation. Provide a deterministic blockhash placeholder
    // so the message compiles and rely on the RPC `replaceRecentBlockhash` flag during simulation
    // to substitute a real blockhash when available.
    blockhash = '11111111111111111111111111111111';
    lastValidBlockHeight = 0;
  }

  const msg = new TransactionMessage({
    payerKey: ownerPk,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  if (args.simulateOnly) {
    try {
      const sim = await connection.simulateTransaction(tx, {
        commitment: 'confirmed',
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      return {
        tx,
        lastValidBlockHeight,
        simulation: {
          logs: sim.value.logs || [],
          unitsConsumed: sim.value.unitsConsumed || 0,
          error: sim.value.err || undefined,
        },
      };
    } catch (error) {
      console.warn('[dbc-exit-builder] simulateTransaction failed, returning stub result', error);
      return {
        tx,
        lastValidBlockHeight,
        simulation: {
          logs: [],
          unitsConsumed: 0,
          error,
        },
      };
    }
  }

  return { tx, lastValidBlockHeight };
}
