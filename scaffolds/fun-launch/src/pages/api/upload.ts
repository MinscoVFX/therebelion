import { NextApiRequest, NextApiResponse } from 'next';
import AWS from 'aws-sdk';
import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';

// Allow bigger base64 payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// Environment variables with type assertions
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID as string;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY as string;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID as string;
const R2_BUCKET = process.env.R2_BUCKET as string;
const RPC_URL = process.env.RPC_URL as string;
const POOL_CONFIG_KEY = process.env.POOL_CONFIG_KEY as string;
const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE as string || '').replace(/\/+$/, ''); // no trailing '/'

if (
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_ACCOUNT_ID ||
  !R2_BUCKET ||
  !RPC_URL ||
  !POOL_CONFIG_KEY ||
  !R2_PUBLIC_BASE
) {
  throw new Error('Missing required environment variables');
}

const PRIVATE_R2_URL = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const PUBLIC_R2_URL = R2_PUBLIC_BASE;

// Helper: discover buy/swap-like functions in whatever SDK version is installed
function findBuyLikeFns(obj: any, path = 'client', seen = new Set<any>()) {
  const hits: string[] = [];
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return hits;
  seen.add(obj);
  for (const key of Object.keys(obj)) {
    const v = (obj as any)[key];
    const p = `${path}.${key}`;
    if (typeof v === 'function') {
      const k = key.toLowerCase();
      if (k.includes('buy') || (k.includes('swap') && !k.includes('quote'))) hits.push(p);
    } else if (v && typeof v === 'object') {
      hits.push(...findBuyLikeFns(v, p, seen));
    }
  }
  return hits;
}

// Types
type UploadRequest = {
  tokenLogo: string;
  tokenName: string;
  tokenSymbol: string;
  mint: string;
  userWallet: string;
  website?: string;
  twitter?: string;
  devPrebuy?: boolean;
  devAmountSol?: string;
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

// R2 client setup (force path-style for R2)
const r2 = new AWS.S3({
  endpoint: PRIVATE_R2_URL,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  region: 'auto',
  signatureVersion: 'v4',
  s3ForcePathStyle: true,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
      devPrebuy,
      devAmountSol,
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

    // Create pool transaction (+ optional atomic dev pre-buy)
    const poolTx = await createPoolTransaction({
      mint,
      tokenName,
      tokenSymbol,
      metadataUrl,
      userWallet,
      devPrebuy: !!devPrebuy,
      devAmountSol: devAmountSol,
    });

    return res.status(200).json({
      success: true,
      poolTx: poolTx
        .serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        })
        .toString('base64'),
    });
  } catch (error) {
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
          type: params.image.endsWith('.png') ? 'image/png' : 'image/jpeg',
        },
      ],
    },
  };
  const fileName = `metadata/${params.mint}.json`;

  try {
    await uploadToR2(Buffer.from(JSON.stringify(metadata, null, 2)), 'application/json', fileName);
    return `${PUBLIC_R2_URL}/${fileName}`;
  } catch (error) {
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
        Bucket: R2_BUCKET,
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

async function createPoolTransaction({
  mint,
  tokenName,
  tokenSymbol,
  metadataUrl,
  userWallet,
  devPrebuy,
  devAmountSol,
}: {
  mint: string;
  tokenName: string;
  tokenSymbol: string;
  metadataUrl: string;
  userWallet: string;
  devPrebuy: boolean;
  devAmountSol?: string;
}) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');

  // 1) Build pool create
  const tx = await client.pool.createPool({
    config: new PublicKey(POOL_CONFIG_KEY),
    baseMint: new PublicKey(mint),
    name: tokenName,
    symbol: tokenSymbol,
    uri: metadataUrl,
    payer: new PublicKey(userWallet),
    poolCreator: new PublicKey(userWallet),
  });

  // 2) Optional: append dev pre-buy IN THE SAME TX (SDK compatibility shim)
  if (devPrebuy && devAmountSol && Number(devAmountSol) > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }));

    const lamports = BigInt(Math.floor(Number(devAmountSol) * LAMPORTS_PER_SOL));
    const params = {
      baseMint: new PublicKey(mint),
      payer: new PublicKey(userWallet),
      solIn: lamports,
      slippageBps: 100,
    };

    const c: any = client as any;

    // Try a wide set of likely entry points across SDK versions
    const candidates: Array<() => Promise<any>> = [];
    if (c?.swap?.buy) candidates.push(() => c.swap.buy(params));
    if (c?.swapBuy) candidates.push(() => c.swapBuy(params));
    if (c?.trade?.buy) candidates.push(() => c.trade.buy(params));
    if (c?.pool?.swap?.buy) candidates.push(() => c.pool.swap.buy(params));
    if (c?.pool?.buy) candidates.push(() => c.pool.buy(params));
    if (c?.buy) candidates.push(() => c.buy(params));
    if (c?.swap?.buildBuy) candidates.push(() => c.swap.buildBuy(params));
    if (c?.pool?.swap?.buildBuy) candidates.push(() => c.pool.swap.buildBuy(params));

    let resp: any;
    let lastErr: any;
    for (const run of candidates) {
      try {
        resp = await run();
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!resp) {
      const found = findBuyLikeFns(client);
      throw new Error(
        `DBC SDK: no working buy() builder found. Candidates discovered:\n` +
          (found.length ? found.join('\n') : '(none)') +
          (lastErr?.message ? `\nLast error: ${lastErr.message}` : '')
      );
    }

    if (Array.isArray(resp)) {
      for (const ix of resp) tx.add(ix);
    } else if (resp?.instructions) {
      for (const ix of resp.instructions) tx.add(ix);
    } else if (resp?.transaction instanceof Transaction) {
      resp.transaction.instructions.forEach((ix: any) => tx.add(ix));
    } else {
      tx.add(resp as any);
    }
  }

  const { blockhash } = await connection.getLatestBlockhash();
  tx.feePayer = new PublicKey(userWallet);
  tx.recentBlockhash = blockhash;

  return tx;
}
