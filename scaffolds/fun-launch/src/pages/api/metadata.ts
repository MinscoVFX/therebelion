import type { NextApiRequest, NextApiResponse } from 'next';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, symbol, description, imageUrl, website, twitter, attributes, ca } = req.body;
    if (!name || !symbol || !imageUrl || !ca) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate a unique file name for metadata JSON
    const fileName = `${crypto.randomBytes(8).toString('hex')}.json`;
    const metadata = {
      name,
      symbol,
      description: description || '',
      image: imageUrl,
      external_url: website || '',
      twitter: twitter || '',
      attributes: attributes || [],
    };

    // Upload metadata to R2
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: `metadata/${fileName}`,
      Body: JSON.stringify(metadata),
      ContentType: 'application/json',
    }));

    const metadataUri = `${process.env.R2_PUBLIC_URL}/metadata/${fileName}`;

    // Append CA to log file
    const logKey = `ca_logs/created_tokens.log`;
    let existingLog = '';
    try {
      const logRes = await r2.send(new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: logKey,
      }));

      // ✅ Fix: safely handle undefined Body
      if (logRes.Body) {
        const bodyString = await streamToString(logRes.Body as any);
        existingLog = bodyString.trim();
      }
    } catch {
      // No log file yet — ignore
    }

    const newLog = `${existingLog}\n${ca}`.trim();
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: logKey,
      Body: newLog,
      ContentType: 'text/plain',
    }));

    return res.status(200).json({ uri: metadataUri });
  } catch (error) {
    console.error('Error uploading metadata:', error);
    return res.status(500).json({ error: 'Failed to upload metadata' });
  }
}

async function streamToString(stream: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
