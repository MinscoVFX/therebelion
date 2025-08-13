// pages/api/metadata.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE } = process.env;

const s3 = new S3Client({
  region: "auto", // R2 doesn't use real AWS regions
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID as string,
    secretAccessKey: R2_SECRET_ACCESS_KEY as string,
  },
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, symbol, description, imageUrl, twitter, website, attributes = [], ca } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
    if (!ca) return res.status(400).json({ error: "mint/CA required" });

    // Generate metadata key
    const id = crypto.randomBytes(8).toString("hex");
    const key = `metadata/${id}.json`;

    const metadata = {
      name,
      symbol,
      description,
      image: imageUrl,
      external_url: website || undefined, // Solscan/wallet preview
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

    // Upload JSON metadata to R2
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET as string,
      Key: key,
      Body: JSON.stringify(metadata),
      ContentType: "application/json",
    }));

    const uri = `${R2_PUBLIC_BASE}${key}`; // R2_PUBLIC_BASE must end with /

    // Append CA to log file (newest first)
    const logKey = "logs/contract_addresses.txt";
    let existingLog = "";

    try {
      const logRes = await s3.send(new GetObjectCommand({
        Bucket: R2_BUCKET as string,
        Key: logKey,
      }));

      if (logRes.Body) {
        const bodyString = await logRes.Body.transformToString();
        existingLog = bodyString.trim();
      }
    } catch {
      existingLog = "";
    }

    const newLog = existingLog ? `${ca}, ${existingLog}` : ca;
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET as string,
      Key: logKey,
      Body: newLog,
      ContentType: "text/plain",
    }));

    return res.status(200).json({ uri });
  } catch (e: any) {
    console.error("Metadata upload failed:", e);
    return res.status(500).json({ error: e?.message || "metadata upload failed" });
  }
}
