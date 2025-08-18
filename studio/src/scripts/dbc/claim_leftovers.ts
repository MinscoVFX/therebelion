/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  type Commitment,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as nacl from 'tweetnacl';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

// ---------- Env helper ----------
const env = (k: string): string => (process.env[k] || '').trim();

const COMMITMENT: Commitment = (env('COMMITMENT_LEVEL') as Commitment) || 'confirmed';

// ---------- Types ----------
type LeftoverReport = {
  baseMint: string;
  pool?: string;
  poolConfig?: string;
  status: 'claimed' | 'skipped' | 'error';
  signature?: string;
  error?: string;
  usedConfig?: string;
  usedProgram?: string;
};

// ---------- Inputs ----------
function parseBaseMintsFromEnv(): PublicKey[] {
  const raw = env('BASE_MINTS');
  if (!raw) throw new Error('BASE_MINTS is empty.');
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('No valid base mints found in BASE_MINTS.');
  return parts.map((s) => new PublicKey(s));
}

function parseConfigKeys(): string[] {
  const raw = env('DBC_CONFIG_KEYS');
  if (!raw) return ['(default)'];
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ['(default)'];
}

function parseProgramIds(): (PublicKey | null)[] {
  const raw = env('DBC_PROGRAM_IDS');
  if (!raw) return [null];
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [null];
  const out: (PublicKey | null)[] = [];
  for (const p of parts) {
    try {
      out.push(new PublicKey(p));
    } catch {
      // skip invalid one
    }
  }
  return out.length ? out : [null];
}

// ---------- Keypair ----------
function jsonArrayToBytes(raw: string): Uint8Array {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid keypair.json format');
  const out: number[] = [];
  for (const v of parsed) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error('keypair.json must be an array of bytes (0..255)');
    out.push(n);
  }
  return Uint8Array.from(out);
}

function readKeypairJsonFile(p: string): Uint8Array {
  const raw = fs.readFileSync(path.resolve(p), 'utf8');
  const bytes = jsonArrayToBytes(raw);
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
  throw new Error(`Unsupported key length ${bytes.length} (need 32 or 64).`);
}

function getSigner(): Keypair {
  const keypairPath = env('KEYPAIR_PATH');
  if (!keypairPath) throw new Error('KEYPAIR_PATH required');
  return Keypair.fromSecretKey(readKeypairJsonFile(keypairPath));
}

// ---------- Wallet ----------
type MinimalWallet = {
  publicKey: PublicKey;
  payer?: Keypair;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

// ---------- Helpers ----------
function safeToBase58Field(obj: any, primary: string, fallback: string): string {
  const field = obj?.[primary] || obj?.[fallback];
  if (field && typeof field.toBase58 === 'function') return field.toBase58();
  return '';
}

function safePoolStatus(pool: any) {
  const status = pool?.state?.status || pool?.status || '';
  const completed =
    status === 'completed' ||
    status === 'finished' ||
    pool?.state?.isFinished === true ||
    pool?.isFinished === true;
  return { status, completed };
}

function safeQuoteVault(pool: any): PublicKey | null {
  const qv = pool?.vaultQuote || pool?.quoteVault || pool?.state?.vaultQuote;
  try {
    return qv ? new PublicKey(qv) : null;
  } catch {
    return null;
  }
}

/**
 * Build candidate clients for every (configKey × programId) combo.
 * We keep ctor calls very permissive to avoid SDK changes blowing up types.
 */
function buildClientCombos(
  connection: Connection,
  wallet: MinimalWallet,
  configKeys: string[],
  programIds: (PublicKey | null)[]
): Array<{ label: string; client: any; programId: PublicKey | null; configKey: string }> {
  const combos: Array<{ label: string; client: any; programId: PublicKey | null; configKey: string }> = [];
  for (const configKey of configKeys) {
    for (const programId of programIds) {
      let client: any;
      try {
        // common constructor signatures we’ve seen:
        // new Client(conn, wallet)
        // new Client(conn, wallet, configKey)
        // new Client(conn, wallet, { programId, ... })
        if (configKey === '(default)') {
          client = new (DynamicBondingCurveClient as any)(connection, wallet);
        } else {
          client = new (DynamicBondingCurveClient as any)(connection, wallet, configKey);
        }
