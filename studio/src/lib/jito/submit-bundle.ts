// scaffolds/fun-launch/src/pages/api/dbc/submit-bundle.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  Connection,
  PublicKey,
  Keypair,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';

// ---------- ENV ----------
const RPC_URL = (process.env.RPC_URL || '').trim(); // standard Solana RPC
const JITO_RELAY_URL = (process.env.JITO_RELAY_URL || '').trim(); // provider endpoint that supports sendBundle
const DEV_PRIVATE_KEY_B58 = (process.env.DEV_PRIVATE_KEY_B58 || '').trim();
const COMMITMENT =
  (process.env.COMMITMENT as 'processed' | 'confirmed' | 'finalized') || 'confirmed';

// ---------- helpers ----------
function bad(
  res: NextApiResponse,
  status: number,
  message: string,
  extra?: Record<string, unknown>
) {
  return res.status(status).json({ ok: false, error: message, ...extra });
}
function parsePubkey(label: string, value?: string) {
  if (!value) throw new Error(`${label} is required`);
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new Error(`${label} is not a valid base58 pubkey`);
  }
}
function loadDevKeypair() {
  if (!DEV_PRIVATE_KEY_B58) throw new Error('Missing DEV_PRIVATE_KEY_B58');
  const secret = bs58.decode(DEV_PRIVATE_KEY_B58);
  return Keypair.fromSecretKey(secret);
}
function parseLamportsFromSol(label: string, sol?: number | string) {
  if (sol === undefined || sol === null || sol === '') throw new Error(`${label} is required`);
  const n = typeof sol === 'string' ? Number(sol) : sol;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be > 0`);
  return BigInt(Math.round(n * 1e9));
}
function base64ToVersionedTx(b64: string): VersionedTransaction {
  const buf = Buffer.from(b64, 'base64');
  return VersionedTransaction.deserialize(buf);
}
function txToBase58(tx: VersionedTransaction): string {
  const raw = tx.serialize();
  return bs58.encode(raw);
}

// ---------- types ----------
type ReqBody = {
  signedCreateTxBase64: string; // client-signed create tx (base64)
  poolAddress: string; // DBC *virtual pool* address (NOT mint, NOT config)
  devBuyAmountSol: number; // SOL to spend from dev wallet
  slippageBps?: number; // ignored for atomic build (we set minOut=1)
  priorityMicroLamports?: number; // optional CU price for dev-buy
  referralTokenAccount?: string; // optional SPL ATA for referral
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return bad(res, 405, 'Method Not Allowed');
    }
    if (!RPC_URL) return bad(res, 500, 'Missing RPC_URL');
    if (!JITO_RELAY_URL) return bad(res, 500, 'Missing JITO_RELAY_URL (must support sendBundle)');

    const {
      signedCreateTxBase64,
      poolAddress,
      devBuyAmountSol,
      priorityMicroLamports,
      referralTokenAccount,
    } = (req.body || {}) as ReqBody;

    if (!signedCreateTxBase64) return bad(res, 400, 'signedCreateTxBase64 is required');
    const poolPubkey = parsePubkey('poolAddress', poolAddress);
    const lamportsIn = parseLamportsFromSol('devBuyAmountSol', devBuyAmountSol);
    const referralTA = referralTokenAccount
      ? parsePubkey('referralTokenAccount', referralTokenAccount)
      : null;

    // 1) Parse client-signed CREATE tx (v0)
    const createTxSigned = base64ToVersionedTx(signedCreateTxBase64);

    // 2) Build DEV-BUY tx WITHOUT pre-reading pool state
    //    (Do NOT call client.state.getPool(...) here — pool doesn't exist yet in chain state.)
    const connection = new Connection(RPC_URL, COMMITMENT);
    const client = new DynamicBondingCurveClient(connection, COMMITMENT);
    const dev = loadDevKeypair();

    // Build swap instructions directly against the pool address.
    // We avoid quoting (which requires pool/config state) and set minimumAmountOut = 1
    // because the create and swap execute atomically in order in the same block.
    const swapTx = await client.pool.swap({
      amountIn: new BN(lamportsIn.toString()),
      minimumAmountOut: new BN(1), // don't pre-quote; atomic with create so snipers can't move price
      swapBaseForQuote: false, // buying token with SOL
      owner: dev.publicKey,
      pool: poolPubkey,
      referralTokenAccount: referralTA,
    });

    // Compose a versioned tx for the dev buy
    const { blockhash } = await connection.getLatestBlockhash(COMMITMENT);
    const ixs = [];

    if (priorityMicroLamports && Number(priorityMicroLamports) > 0) {
      ixs.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: Number(priorityMicroLamports),
        })
      );
    }
    ixs.push(...swapTx.instructions);

    const msg = new TransactionMessage({
      payerKey: dev.publicKey,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const devBuyTx = new VersionedTransaction(msg);
    devBuyTx.sign([dev]); // server signs dev-buy (spends SOL from dev wallet)

    // 3) Ship both as a Jito bundle: [CREATE (client-signed), DEV-BUY (server-signed)]
    const encoded = [txToBase58(createTxSigned), txToBase58(devBuyTx)];
    const rpcPayload = { jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [encoded] };

    const resp = await fetch(JITO_RELAY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcPayload),
    });
    const json = (await resp
      .json()
      .catch(() => null)) as { error?: string; result?: string } | null;

    if (!resp.ok || !json || json.error) {
      return bad(res, 502, 'sendBundle failed', { providerResponse: json || (await resp.text()) });
    }

    // Provider returns a bundle id (base58). Execution is ordered & atomic within the block.
    return res.status(200).json({ ok: true, bundleId: json.result });
  } catch (err: any) {
    return bad(res, 500, err?.message || 'Unexpected error');
  }
}
