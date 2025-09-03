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

// Allow bigger base64 payloads (avoid 413 with large logos)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb', // was 10mb
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
// Supports:
// - NEXT_PUBLIC_CREATION_FEE_RECEIVERS="Wallet1:0.020,Wallet2:0.015"
// - Fallback: NEXT_PUBLIC_CREATION_FEE_RECEIVER="Wallet" (defaults to 0.035 SOL)
type FeeSplit = { receiver: PublicKey; lamports: number };

function getFeeSplits(): FeeSplit[] {
  const rawMulti = process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVERS || '';
  const rawSingle = process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER || '';

  if (rawMulti.trim()) {
    return rawMulti
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((pair) => {
        const [addr, solStr] = pair.split(':');
        if (!addr || !solStr) throw new Error(`Invalid fee split: "${pair}"`);
        const sol = parseFloat(solStr);
        if (!Number.isFinite(sol) || sol <= 0) throw new Error(`Invalid SOL amount in "${pair}"`);
        return {
          receiver: new PublicKey(addr),
          lamports: Math.floor(sol * LAMPORTS_PER_SOL),
        };
      });
  }

  if (rawSingle.trim()) {
    // default 0.035 SOL if only single receiver is set
    return [{ receiver: new PublicKey(rawSingle), lamports: 35_000_000 }];
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

// R2 client setup (safe to construct; failures surface on use)
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

    // Create pool transaction (+ optional atomic dev pre-buy) with fees prepended
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
  const connection = new Connection(RPC_URL as string, 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');

  // 1) Build pool create
  const tx = await client.pool.createPool({
    config: new PublicKey(POOL_CONFIG_KEY as string),
    baseMint: new PublicKey(mint),
    name: tokenName,
    symbol: tokenSymbol,
    uri: metadataUrl,
    payer: new PublicKey(userWallet),
    poolCreator: new PublicKey(userWallet),
  });

  // 1.a) Prepend fees from env — transfers + a single top memo

  const splits = getFeeSplits();

  // Add transfers first (preserve env order by iterating a reversed copy)
  for (const split of splits.slice().reverse()) {
    const transferIx = SystemProgram.transfer({
      fromPubkey: new PublicKey(userWallet),
      toPubkey: split.receiver,
      lamports: split.lamports,
    });
    tx.instructions.unshift(transferIx);
  }

  // Single branded memo at the very top so Phantom shows it first
  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: new PublicKey(userWallet), isSigner: true, isWritable: false }],
    data: Buffer.from('Meteora Protocol Fees (fees can fluctuate)', 'utf8'),
  });
  tx.instructions.unshift(memoIx);

  // 2) Optional: append dev pre-buy IN THE SAME TX using SDK swap()
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

    // Prefer transaction.swap (gives Transaction/instructions to merge), then rpc.swap
    const tryFns: Array<() => Promise<any>> = [
      c?.pool?.program?.transaction?.swap && (() => c.pool.program.transaction.swap(params)),
      c?.pool?.program?.rpc?.swap && (() => c.pool.program.rpc.swap(params)),
      c?.program?.transaction?.swap && (() => c.program.transaction.swap(params)),
      c?.program?.rpc?.swap && (() => c.program.rpc.swap(params)),
      c?.state?.program?.transaction?.swap && (() => c.state.program.transaction.swap(params)),
      c?.state?.program?.rpc?.swap && (() => c.state.program.rpc.swap(params)),
      c?.creator?.program?.transaction?.swap && (() => c.creator.program.transaction.swap(params)),
      c?.creator?.program?.rpc?.swap && (() => c.creator.program.rpc.swap(params)),
      c?.partner?.program?.transaction?.swap && (() => c.partner.program.transaction.swap(params)),
      c?.partner?.program?.rpc?.swap && (() => c.partner.program.rpc.swap(params)),
      c?.migration?.program?.transaction?.swap && (() => c.migration.program.transaction.swap(params)),
      c?.migration?.program?.rpc?.swap && (() => c.migration.program.rpc.swap(params)),
    ].filter(Boolean) as any[];

    let resp: any;
    let lastErr: any;
    for (const run of tryFns) {
      try {
        resp = await run();
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!resp) {
      throw new Error(
        `DBC SDK: no working swap() builder found.${lastErr?.message ? ' Last error: ' + lastErr.message : ''}`
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
