import type { NextApiRequest, NextApiResponse } from "next";
import AWS from "aws-sdk";
import crypto from "crypto";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE } = process.env;

const s3 = new AWS.S3({
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
  s3ForcePathStyle: true,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { name, symbol, description, imageUrl, twitter, website, attributes = [] } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });

    const id = crypto.randomBytes(8).toString("hex");
    const key = `metadata/${id}.json`;

    const metadata = {
      name,
      symbol,
      description,
      image: imageUrl,
      external_url: website || undefined,     // shows in Solscan/wallets
      extensions: {
        twitter: twitter || undefined,
        website: website || undefined,
      },
      properties: {
        category: "image",
        files: [{ uri: imageUrl, type: imageUrl.endsWith(".png") ? "image/png" : "image/jpeg" }],
      },
      attributes,
    };

    await s3.putObject({
      Bucket: R2_BUCKET as string,
      Key: key,
      Body: JSON.stringify(metadata),
      ContentType: "application/json",
    }).promise();

    const uri = `${R2_PUBLIC_BASE}${key}`; // R2_PUBLIC_BASE must end with /
    return res.status(200).json({ uri, key });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "metadata upload failed" });
  }
}
