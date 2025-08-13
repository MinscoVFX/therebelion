// scaffolds/fun-launch/src/pages/api/metadata.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";
import { Readable } from "stream";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE,
} = process.env;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: (R2_ACCESS_KEY_ID as string) || "",
    secretAccessKey: (R2_SECRET_ACCESS_KEY as string) || "",
  },
});

// helper: read R2 stream to string
function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      name,
      symbol,
      description,
      imageUrl,
      twitter,
      website,
      attributes = [],
      ca,
    } = req.body || {};

    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
    if (!ca) return res.status(400).json({ error: "mint/CA required" });
    if (!R2_BUCKET || !R2_PUBLIC_BASE) {
      return res.status(500).json({ error: "R2 env not configured" });
    }

    // ensure base ends with slash
    const base = R2_PUBLIC_BASE.endsWith("/") ? R2_PUBLIC_BASE : `${R2_PUBLIC_BASE}/`;

    // 1) upload NFT metadata JSON to R2
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
        files: [
          {
            uri: imageUrl,
            type: imageUrl.endsWith(".png")
              ? "image/png"
              : imageUrl.endsWith(".svg")
              ? "image/svg+xml"
              : "image/jpeg",
          },
        ],
      },
      attributes,
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: JSON.stringify(metadata),
        ContentType: "application/json",
      })
    );

    const uri = `${base}${key}`;

    // 2) prepend CA to log list (reverse-chronological)
    const logKey = "logs/contract_addresses.txt";
    let existingLog = "";
    try {
      const logRes = await s3.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: logKey })
      );
      if (logRes.Body) {
        existingLog = (await streamToString(logRes.Body as Readable)).trim();
      }
    } catch {
      // if missing, start fresh
      existingLog = "";
    }

    const newLog = existingLog ? `${ca}, ${existingLog}` : ca;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: logKey,
        Body: newLog,
        ContentType: "text/plain",
      })
    );

    return res.status(200).json({ uri });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "metadata upload failed" });
  }
}
