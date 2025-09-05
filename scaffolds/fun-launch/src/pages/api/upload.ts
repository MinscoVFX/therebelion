import { NextApiRequest, NextApiResponse } from 'next';
import AWS from 'aws-sdk';
import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Buffer } from 'buffer'; // ✅ ensure Buffer type is available in TS/Node

// Allow bigger base64 payloads (avoid 413 with large logos)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

// Env vars (read values but DO NOT throw at import time)
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID as string | undefined;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY as string | undefined;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID as string | undefined;
const R2_BUCKET = process.env.R2_BUCKET as string | undefined;
const RPC_URL = process.env.RPC_URL as string | undefined;
const POOL_CONFIG_KEY = process.env.POOL_CONFIG_KEY as string | undefined;
const R2_PUBLIC_BASE = ((process.env.R2_PUBLIC_BASE as string) || '').replace(/\/+$/, ''); // no trailing '/'

// Memo program
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ---------- helpers ----------
function sanitize(s: string | undefined | null): string {
  return (s ?? '').trim().replace(/\u200B/g, '');
}
function parsePubkey(label: string, value: string): PublicKey {
  const v = sanitize(value);
  try {
    return new PublicKey(v);
  } catch {
    throw new Error(`${label} is not a valid base58 pubkey: "${v}"`);
  }
}

// Validate base envs at runtime (so errors return JSON, not HTML)
function validateBaseEnv(): string[] {
  const missing: string[] = [];
  if (!R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
  if (!R2_BUCKET) missing.push('R2_BUCKET');
  if (!RPC_URL) missing.push('RPC_URL');
  if (!POOL_CONFIG_KEY) missing.push('POOL_CONFIG_KEY');
  if (!R2_PUBLIC_BASE) missing.push('R2_PUBLIC_BASE');
  return missing;
}

// --- Fee splits parser ---
type FeeSplit = { receiver: PublicKey; lamports: number };

function getFeeSplits(): FeeSplit[] {
  const rawMulti = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVERS);
  const rawSingle = sanitize(process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER);

  if (rawMulti) {
    return rawMulti
      .split(',')
      .map((entry) => sanitize(entry))
      .filter(Boolean)
      .map((pair) => {
        const [addrRaw, solStrRaw] = pair.split(':');
        const addr = sanitize(addrRaw);
        const solStr = sanitize(solStrRaw);
        if (!addr || !solStr) {
          throw new Error(`Invalid fee split format: "${pair}". Use "Wallet:0.020"`);
        }
        const receiver = parsePubkey('Fee receiver', addr);
        const sol = parseFloat(solStr);
        if (!Number.isFinite(sol) || sol <= 0) {
          throw new Error(`Invalid SOL amount in split "${pair}" (got "${solStr}")`);
        }
        return {
          receiver,
          lamports: Math.floor(sol * LAMPORTS_PER_SOL),
        };
      });
  }

  if (rawSingle) {
    const receiver = parsePubkey('NEXT_PUBLIC_CREATION_FEE_RECEIVER', rawSingle);
    // default 0.035 SOL if only single receiver is set
    return [{ receiver, lamports: 35_000_000 }];
  }

  throw new Error(
    'Missing fee receivers. Set NEXT_PUBLIC_CREATION_FEE_RECEIVERS="Wallet:0.020,Wallet:0.015" or NEXT_PUBLIC_CREATION_FEE_RECEIVER="Wallet"'
  );
}

const PRIVATE_R2_URL = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const PUBLIC_R2_URL = R2_PUBLIC_BASE;

// Types
type UploadRequest = {
  tokenLogo: string;
  tokenName: string;
  tokenSymbol: string;
  mint: string;
  userWallet: string;
  website?: string;
  twitter?: string;
  devPrebuy?: boolean; // accepted, but NOT executed here anymore
  devAmountSol?: string; // accepted, but NOT executed here anymore
};

type Metadata = {
  name: string;
  symbol: string;
  image: string;
  external_url?: string;
  extensions?: {
    twitter?: string;
    website?: string;
  };
  properties?: {
    category?: string;
    files?: { uri: string; type: string }[];
  };
};

type MetadataUploadParams = {
  tokenName: string;
  tokenSymbol: string;
  mint: string;
  image: string;
  website?: string;
  twitter?: string;
};

// R2 client setup
const r2 = new AWS.S3({
  endpoint: PRIVATE_R2_URL,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  region: 'auto',
  signatureVersion: 'v4',
  s3ForcePathStyle: true,
});

// --- Infer pool from the createPool ix we just built (best-effort) ---
function inferPoolFromTx(
  tx: Transaction,
  baseMint: PublicKey,
  cfgKey: PublicKey,
  payer: PublicKey
): PublicKey | undefined {
  const ignore = new Set([baseMint.toBase58(), cfgKey.toBase58(), payer.toBase58()]);
  for (const ix of tx.instructions) {
    const keySet = new Set(ix.keys.map((k) => k.pubkey.toBase58()));
    if (keySet.has(baseMint.toBase58()) && keySet.has(cfgKey.toBase58())) {
      const candidate = ix.keys.find(
        (k) => k.isWritable && !k.isSigner && !ignore.has(k.pubkey.toBase58())
      );
      if (candidate) return candidate.pubkey;
    }
  }
  return undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate envs at runtime so client always gets JSON
  const missing = validateBaseEnv();
  if (missing.length) {
    return res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
  }

  try {
    const {
      tokenLogo,
      tokenName,
      tokenSymbol,
      mint,
      userWallet,
      website,
      twitter,
      // NOTE: devPrebuy & devAmountSol are intentionally ignored for tx building
      //       (we build the buy in /api/build-swap prelaunch mode and bundle)
    } = req.body as UploadRequest;

    // Validate required fields
    if (!tokenLogo || !tokenName || !tokenSymbol || !mint || !userWallet) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Upload image and metadata
    const imageUrl = await uploadImage(tokenLogo, mint);
    if (!imageUrl) {
      return res.status(400).json({ error: 'Failed to upload image' });
    }

    const metadataUrl = await uploadMetadata({
      tokenName,
      tokenSymbol,
      mint,
      image: imageUrl,
      website,
      twitter,
    });
    if (!metadataUrl) {
      return res.status(400).json({ error: 'Failed to upload metadata' });
    }

    // Build CREATE-POOL tx ONLY (fees + memo are prepended)
    const { tx: poolTxRaw, pool: inferredPool } = await buildCreatePoolTxOnly({
      mint,
      tokenName,
      tokenSymbol,
      metadataUrl,
      userWallet,
    });

    const poolTxBase64 = poolTxRaw
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    return res.status(200).json({
      success: true,
      poolTx: poolTxBase64,
      pool: inferredPool ? inferredPool.toBase58() : null,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Upload error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function uploadImage(tokenLogo: string, mint: string): Promise<string | false> {
  const matches = tokenLogo.match(/^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return false;

  let [, contentType, base64Data] = matches;
  if (!contentType || !base64Data) return false;

  contentType = contentType.toLowerCase();
  if (contentType === 'image/jpg') contentType = 'image/jpeg';

  base64Data = base64Data.replace(/ /g, '+');
  const fileBuffer = Buffer.from(base64Data, 'base64');
  const ext = contentType.split('/')[1] || 'png';
  const fileName = `images/${mint}.${ext}`;

  try {
    await uploadToR2(fileBuffer, contentType, fileName);
    return `${PUBLIC_R2_URL}/${fileName}`;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error uploading image:', error);
    return false;
  }
}

async function uploadMetadata(params: MetadataUploadParams): Promise<string | false> {
  const metadata: Metadata = {
    name: params.tokenName,
    symbol: params.tokenSymbol,
    image: params.image,
    external_url: params.website || undefined,
    extensions: {
      twitter: params.twitter || undefined,
      website: params.website || undefined,
    },
    properties: {
      category: 'image',
      files: [
        {
          uri: params.image,
          type: params.image.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
        },
      ],
    },
  };
  const fileName = `metadata/${params.mint}.json`;

  try {
    await uploadToR2(Buffer.from(JSON.stringify(metadata, null, 2)), 'application/json', fileName);
    return `${PUBLIC_R2_URL}/${fileName}`;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error uploading metadata:', error);
    return false;
  }
}

async function uploadToR2(
  fileBuffer: Buffer,
  contentType: string,
  fileName: string
): Promise<AWS.S3.PutObjectOutput> {
  return new Promise((resolve, reject) => {
    r2.putObject(
      {
        Bucket: R2_BUCKET as string,
        Key: fileName,
        Body: fileBuffer,
        ContentType: contentType,
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data);
      }
    );
  });
}

async function buildCreatePoolTxOnly({
  mint,
  tokenName,
  tokenSymbol,
  metadataUrl,
  userWallet,
}: {
  mint: string;
  tokenName: string;
  tokenSymbol: string;
  metadataUrl: string;
  userWallet: string;
}): Promise<{ tx: Transaction; pool?: PublicKey }> {
  const connection = new Connection(sanitize(RPC_URL as string), 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');

  // Validate pubkeys with clear labels
  const cfgKey = parsePubkey('POOL_CONFIG_KEY', POOL_CONFIG_KEY as string);
  const baseMint = parsePubkey('mint', mint);
  const payer = parsePubkey('userWallet', userWallet);

  // 1) Build pool create
  const tx = await client.pool.createPool({
    config: cfgKey,
    baseMint,
    name: tokenName,
    symbol: tokenSymbol,
    uri: metadataUrl,
    payer,
    poolCreator: payer,
  });

  // 1.a) Prepend fees from env — ensure FIRST ix is a SystemProgram.transfer
  const splits = getFeeSplits();
  const transferIxs = splits.map((split) =>
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: split.receiver,
      lamports: split.lamports,
    })
  );

  // Optional: small compute price bump (AFTER fee transfers so first ix is transfer)
  const computeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 });

  // Brand memo (placed AFTER transfers)
  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from('Meteora Protocol Fees (fees can fluctuate)', 'utf8'),
  });

  // Ensure ordering: [transfers..., memo, compute, ...original createPool ixs]
  tx.instructions = [...transferIxs, memoIx, computeIx, ...tx.instructions];

  // Infer pool *now* (so we can return it in response)
  const inferredPool = inferPoolFromTx(tx, baseMint, cfgKey, payer);

  const { blockhash } = await connection.getLatestBlockhash();
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;

  return { tx, pool: inferredPool };
}
