// Path: scaffolds/fun-launch/src/pages/api/metadata.ts
// Purpose: Upload token metadata JSON to Cloudflare R2 and return its public URI.

import type { NextApiRequest, NextApiResponse } from "next";
import AWS from "aws-sdk";
import crypto from "crypto";

/** Body shape expected from client */
type Attribute =
  | { trait_type: string; value: string | number | boolean }
  | Record<string, unknown>;

interface MetadataBody {
  name?: string;
  symbol?: string;
  description?: string;
  imageUrl?: string;
  twitter?: string;
  website?: string;
  attributes?: Attribute[];
}

/** Ensure this API uses Node runtime (AWS SDK v2 needs Node APIs) */
export const config = {
  api: { bodyParser: true },
};

/** Env helpers */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env: ${name}`);
  return v;
}

function normalizeBaseUrl(u: string): string {
  return u.endsWith("/") ? u : `${u}/`;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function guessImageMime(url: string): string {
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
    if (p.endsWith(".gif")) return "image/gif";
    if (p.endsWith(".webp")) return "image/webp";
  } catch {
    /* ignore */
  }
  return "image/*";
}

/** Build R2 S3 client */
function createS3(): AWS.S3 {
  const R2_ACCOUNT_ID = requireEnv("R2_ACCOUNT_ID");
  const R2_ACCESS_KEY_ID = requireEnv("R2_ACCESS_KEY_ID");
  const R2_SECRET_ACCESS_KEY = requireEnv("R2_SECRET_ACCESS_KEY");

  return new AWS.S3({
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    signatureVersion: "v4",
    s3ForcePathStyle: true,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      name = "",
      symbol = "",
      description = "",
      imageUrl,
      twitter,
      website,
      attributes = [],
    } = (req.body ?? {}) as MetadataBody;

    if (!imageUrl || !isHttpUrl(imageUrl)) {
      return res.status(400).json({ error: "imageUrl (http/https) required" });
    }

    const metadata = {
      name,
      symbol,
      description,
      image: imageUrl,
      external_url: website && website.trim() ? website : undefined,
      extensions: {
        twitter: twitter && twitter.trim() ? twitter : undefined,
        website: website && website.trim() ? website : undefined,
      },
      properties: {
        category: "image",
        files: [{ uri: imageUrl, type: guessImageMime(imageUrl) }],
      },
      attributes: Array.isArray(attributes) ? attributes : [],
    };

    const R2_BUCKET = requireEnv("R2_BUCKET");
    const R2_PUBLIC_BASE = normalizeBaseUrl(requireEnv("R2_PUBLIC_BASE"));

    const s3 = createS3();
    const id = crypto.randomBytes(8).toString("hex");
    const key = `metadata/${id}.json`;

    await s3
      .putObject({
        Bucket: R2_BUCKET,
        Key: key,
        Body: JSON.stringify(metadata),
        ContentType: "application/json",
      })
      .promise();

    const uri = `${R2_PUBLIC_BASE}${key}`;
    return res.status(200).json({ uri, key });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "metadata upload failed";
    return res.status(500).json({ error: message });
  }
}
