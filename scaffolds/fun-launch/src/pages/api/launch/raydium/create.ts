// scaffolds/fun-launch/src/pages/api/launch/raydium/create.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { PublicKey, Transaction } from '@solana/web3.js';
import { buildCreateLaunchpadTx } from '@/adapters/raydium';

type Ok = { tx: string };
type Err = { error: string; code?: string };

function bad(res: NextApiResponse<Err>, error: string, code?: string, status = 400) {
  return res.status(status).json({ error, code });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok | Err>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return bad(res, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', 405);
  }

  try {
    const {
      creator,
      name,
      symbol,
      decimals,
      imageUrl,
      description,
      supplyTokens,
      raiseTargetLamports,
      migrateType,
      existingMint, // vanity BYO mint (base58)
      // passthrough (optional)
      tokenLogo,
      website,
      twitter,
    } = (req.body ?? {}) as Record<string, any>;

    // Basic validation
    if (!creator || !name || !symbol) {
      return bad(res, 'Missing required fields (creator, name, symbol)', 'MISSING_FIELDS');
    }
    const creatorPk = new PublicKey(creator);
    const platformPdaStr = process.env.RAYDIUM_PLATFORM_PDA;
    const shareBpsStr = process.env.RAYDIUM_SHARE_FEE_BPS ?? '20';
    const creationFeeStr = process.env.RAYDIUM_CREATION_FEE_LAMPORTS ?? '0';
    const creationFeeRecvStr = process.env.NEXT_PUBLIC_CREATION_FEE_RECEIVER;

    if (!platformPdaStr) return bad(res, 'RAYDIUM_PLATFORM_PDA not set', 'MISSING_ENV');
    if (!creationFeeRecvStr) return bad(res, 'NEXT_PUBLIC_CREATION_FEE_RECEIVER not set', 'MISSING_ENV');

    const platformPda = new PublicKey(platformPdaStr);
    const creationFeeReceiver = new PublicKey(creationFeeRecvStr);
    const shareFeeBps = Number(shareBpsStr);
    const creationFeeLamports = BigInt(creationFeeStr);
    const totalSellTokens = BigInt(String(supplyTokens ?? '0'));
    const fundRaiseLamports = BigInt(String(raiseTargetLamports ?? '0'));
    const decimalsNum = Number(decimals ?? 6);
    const migrate: 'amm' | 'cpmm' = migrateType === 'cpmm' ? 'cpmm' : 'amm';

    const existingMintPk = existingMint ? new PublicKey(existingMint) : undefined;

    // Build tx via adapter.
    // NOTE: The adapter will throw { code: 'RAYDIUM_SDK_MISSING' | 'RAYDIUM_NOT_WIRED', message: ... }
    // until we finish wiring the SDK. We convert those to 501 so your app doesn't crash.
    const tx: Transaction = await buildCreateLaunchpadTx({
      creator: creatorPk,
      platformPda,
      shareFeeBps,
      creationFeeLamports,
      creationFeeReceiver,
      name,
      symbol,
      decimals: decimalsNum,
      imageUrl,
      description,
      supplyTokens: totalSellTokens,
      raiseTargetLamports: fundRaiseLamports,
      migrateType: migrate,
      existingMint: existingMintPk,
    });

    const serialized = tx.serialize({ requireAllSignatures: false });
    return res.status(200).json({ tx: Buffer.from(serialized).toString('base64') });
  } catch (e: any) {
    const code = e?.code || undefined;
    const msg = e?.message || String(e);

    if (code === 'RAYDIUM_SDK_MISSING' || code === 'RAYDIUM_NOT_WIRED') {
      // Graceful, non-breaking placeholder response until SDK is installed/wired.
      return bad(res, msg, code, 501);
    }

    console.error('Raydium create handler error:', e);
    return bad(res, msg, code, 500);
  }
}
