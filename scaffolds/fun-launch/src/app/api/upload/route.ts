// scaffolds/fun-launch/src/app/api/upload/route.ts
import { NextResponse } from 'next/server';
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
import { Buffer } from 'buffer';
import { resolveRpc } from '../../../lib/rpc';

// ---------- env (read; validate at runtime) ----------
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID as string | undefined;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY as string | undefined;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID as string | undefined;
const R2_BUCKET = process.env.R2_BUCKET as string | undefined;
const POOL_CONFIG_KEY = process.env.POOL_CONFIG_KEY as string | undefined;
const R2_PUBLIC_BASE = ((process.env.R2_PUBLIC_BASE as string) || '').replace(/\/+$/, '');

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
function validateBaseEnv(): string[] {
  const missing: string[] = [];
  if (!R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
  if (!R2_BUCKET) missing.push('R2_BUCKET');
  if (!POOL_CONFIG_KEY) missing.push('POOL_CONFIG_KEY');
  if (!R2_PUBLIC_BASE) missing.push('R2_PUBLIC_BASE');
  return missing;
}

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
        if (!addr || !solStr)
          throw new Error(`Invalid fee split format: "${pair}". Use "Wallet:0.020"`);
        const receiver = parsePubkey('Fee receiver', addr);
        const sol = parseFloat(solStr);
        if (!Number.isFinite(sol) || sol <= 0)
          throw new Error(`Invalid SOL amount in split "${pair}"`);
        return { receiver, lamports: Math.floor(sol * LAMPORTS_PER_SOL) };
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

// ---------- request/response types ----------
type UploadRequest = {
  tokenLogo: string;
  tokenName: string;
  tokenSymbol: string;
  mint: string;
  userWallet: string;
  website?: string;
  twitter?: string;
  // accepted but not executed here (the dev-buy happens in the bundle path)
  devPrebuy?: boolean;
  devAmountSol?: string;
};

type Metadata = {
  name: string;
  symbol: string;
  image: string;
  external_url?: string;
  extensions?: { twitter?: string; website?: string };
  properties?: { category?: string; files?: { uri: string; type: string }[] };
};

type MetadataUploadParams = {
  tokenName: string;
  tokenSymbol: string;
  mint: string;
  image: string;
  website?: string;
  twitter?: string;
};

// ---------- R2 client ----------
const r2 = new AWS.S3({
  endpoint: PRIVATE_R2_URL,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  region: 'auto',
  signatureVersion: 'v4',
  s3ForcePathStyle: true,
});

// Infer the virtual pool PDA from the create tx (best effort, no reads)
function inferPoolFromTx(
  tx: Transaction,
  baseMint: PublicKey,
  cfgKey: PublicKey,
  payer: PublicKey
): PublicKey | undefined {
  const ignore = new Set([baseMint.toBase58(), cfgKey.toBase58(), payer.toBase58()]);
  for (const ix of tx.instructions) {
    const keySet = new Set(ix.keys.map((k) => k.pubkey.toBase58()));
    // heuristic: ix touching both baseMint and config, writable non-signer key ≠ {mint,cfg,payer}
    if (keySet.has(baseMint.toBase58()) && keySet.has(cfgKey.toBase58())) {
      const candidate = ix.keys.find(
        (k) => k.isWritable && !k.isSigner && !ignore.has(k.pubkey.toBase58())
      );
      if (candidate) return candidate.pubkey;
    }
  }
  return undefined;
}

// ---------- handler ----------
export async function POST(req: Request) {
  const missing = validateBaseEnv();
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing environment variables: ${missing.join(', ')}` },
      { status: 500 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { tokenLogo, tokenName, tokenSymbol, mint, userWallet, website, twitter } =
      body as UploadRequest;

    if (!tokenLogo || !tokenName || !tokenSymbol || !mint || !userWallet) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1) Upload image
    const imageUrl = await uploadImage(tokenLogo, mint);
    if (!imageUrl) return NextResponse.json({ error: 'Failed to upload image' }, { status: 400 });

    // 2) Upload metadata JSON
    const metadataUrl = await uploadMetadata({
      tokenName,
      tokenSymbol,
      mint,
      image: imageUrl,
      website,
      twitter,
    });
    if (!metadataUrl)
      return NextResponse.json({ error: 'Failed to upload metadata' }, { status: 400 });

    // 3) Build CREATE tx only (prepend fee transfers + memo + small CU bump)
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

    return NextResponse.json({
      success: true,
      poolTx: poolTxBase64,
      pool: inferredPool ? inferredPool.toBase58() : null,
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

// ---------- uploads ----------
async function uploadImage(tokenLogo: string, mint: string): Promise<string | false> {
  const m = tokenLogo.match(/^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!m || m.length !== 3) return false;

  let [, contentType, base64Data] = m;
  if (!contentType || !base64Data) return false;

  contentType = contentType.toLowerCase();
  if (contentType === 'image/jpg') contentType = 'image/jpeg';

  // choose extension safely (support svg)
  let ext = contentType.split('/')[1] || 'png';
  if (ext === 'svg+xml') ext = 'svg';

  base64Data = base64Data.replace(/ /g, '+');
  const fileBuffer = Buffer.from(base64Data, 'base64');
  const fileName = `images/${mint}.${ext}`;

  try {
    await uploadToR2(fileBuffer, contentType, fileName);
    return `${PUBLIC_R2_URL}/${fileName}`;
  } catch (e) {
    console.error('Error uploading image:', e);
    return false;
  }
}

async function uploadMetadata(params: MetadataUploadParams): Promise<string | false> {
  // detect mime for files[]
  const fileType = params.image.toLowerCase().endsWith('.png')
    ? 'image/png'
    : params.image.toLowerCase().endsWith('.svg')
      ? 'image/svg+xml'
      : 'image/jpeg';

  const metadata: Metadata = {
    name: params.tokenName,
    symbol: params.tokenSymbol,
    image: params.image,
    external_url: params.website || undefined,
    extensions: { twitter: params.twitter || undefined, website: params.website || undefined },
    properties: { category: 'image', files: [{ uri: params.image, type: fileType }] },
  };

  const fileName = `metadata/${params.mint}.json`;

  try {
    await uploadToR2(Buffer.from(JSON.stringify(metadata, null, 2)), 'application/json', fileName);
    return `${PUBLIC_R2_URL}/${fileName}`;
  } catch (e) {
    console.error('Error uploading metadata:', e);
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
      (err, data) => (err ? reject(err) : resolve(data))
    );
  });
}

// ---------- tx builder (no pre-reads) ----------
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
  const connection = new Connection(resolveRpc(), 'confirmed');
  const client = new DynamicBondingCurveClient(connection, 'confirmed');

  const cfgKey = parsePubkey('POOL_CONFIG_KEY', POOL_CONFIG_KEY as string);
  const baseMint = parsePubkey('mint', mint);
  const payer = parsePubkey('userWallet', userWallet);

  // 1) Build pool create (SDK returns a legacy Transaction with instructions)
  const tx = await client.pool.createPool({
    config: cfgKey,
    baseMint,
    name: tokenName,
    symbol: tokenSymbol,
    uri: metadataUrl,
    payer,
    poolCreator: payer,
  });

  // 2) Prepend creation-fee splits FIRST (your fee validator expects this order)
  const splits = getFeeSplits();
  const transferIxs = splits.map((split) =>
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: split.receiver,
      lamports: split.lamports,
    })
  );

  // 3) Optional brand memo (after transfers)
  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from('Meteora Protocol Fees (fees can fluctuate)', 'utf8'),
  });

  // 4) Small compute price bump (AFTER transfers, BEFORE heavy create ixs)
  const computeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 });

  // Ensure order: [transfers..., memo, compute, ...createPool]
  tx.instructions = [...transferIxs, memoIx, computeIx, ...tx.instructions];

  // Best-effort virtual pool inference (no on-chain read)
  const inferredPool = inferPoolFromTx(tx, baseMint, cfgKey, payer);

  // Fee payer + blockhash
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;

  return { tx, pool: inferredPool };
}
