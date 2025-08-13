// pages/api/metadata.ts
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
    const { name, symbol, description, imageUrl, twitter, website, attributes = [], ca } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
    if (!ca) return res.status(400).json({ error: "mint/CA required" });

    // Upload JSON to R2
    const id = crypto.randomBytes(8).toString("hex");
    const key = `metadata/${id}.json`;

    const metadata = {
      name,
      symbol,
      description,
      image: imageUrl,
      external_url: website || undefined,
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

    const uri = `${R2_PUBLIC_BASE}${key}`;

    // Append CA to log file — newest first
    const logKey = "logs/contract_addresses.txt";
    let existingLog = "";
    try {
      const logRes = await s3.getObject({ Bucket: R2_BUCKET as string, Key: logKey }).promise();
      existingLog = logRes.Body.toString("utf-8").trim();
    } catch {
      existingLog = "";
    }

    // Put newest CA first
    const newLog = existingLog ? `${ca}\n${existingLog}` : ca;
    await s3.putObject({
      Bucket: R2_BUCKET as string,
      Key: logKey,
      Body: newLog,
      ContentType: "text/plain",
    }).promise();

    return res.status(200).json({ uri });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "metadata upload failed" });
  }
}
