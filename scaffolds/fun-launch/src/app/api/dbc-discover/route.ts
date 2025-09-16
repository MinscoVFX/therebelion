export const runtime = 'nodejs';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Metadata, PROGRAM_ID as TMETA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata';

// Token-2022 Program ID (hardcoded as it's a standard program)
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

function getRpcEndpoint() {
  const rpc = process.env.RPC_ENDPOINT || process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;

  if (!rpc) throw new Error('Missing RPC endpoint');
  return rpc;
}

// Broad but deterministic hints (no "real value" envs required).
// These cover Meteora DBC position NFTs that appear as "Meteora (...) LP Token" with supply 1 / decimals 0.
const NAME_HINTS = (process.env.DBC_POSITION_NAME_HINTS || 'dbc,meteora,position,lp token')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const SYMBOL_HINTS = (process.env.DBC_POSITION_SYMBOL_HINTS || 'dbc,dbcp0s,mpn')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Optional allow-list via env (zero-config OK). If provided, it strengthens positive matches.
const UPDATE_AUTH_ALLOW = (process.env.DBC_POSITION_UPDATE_AUTHORITIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function looksLikeDbc(meta: Metadata): boolean {
  const name = (meta.data?.name || '').toLowerCase();
  const symbol = (meta.data?.symbol || '').toLowerCase();
  const ua = meta.updateAuthority?.toBase58?.() || '';

  // Any of: explicit allow-list, name hint, symbol hint
  if (ua && UPDATE_AUTH_ALLOW.includes(ua)) return true;
  if (NAME_HINTS.some((h) => name.includes(h))) return true;
  if (SYMBOL_HINTS.some((h) => symbol.includes(h))) return true;
  return false;
}

async function fetchMetadata(mint: PublicKey, connection: Connection): Promise<Metadata | null> {
  try {
    const [metaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TMETA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      TMETA_PROGRAM_ID
    );
    const acc = await connection.getAccountInfo(metaPda);
    if (!acc) return null;
    const [meta] = Metadata.deserialize(acc.data);
    return meta;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const walletStr = searchParams.get('wallet') || '';
  if (!walletStr) return NextResponse.json({ error: 'wallet missing' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

    const owner = new PublicKey(walletStr);

    // Create connection at runtime
    const connection = new Connection(getRpcEndpoint(), 'confirmed');

    // Query BOTH token programs — key fix.
    const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
    const tokenAccounts: any[] = [];
    for (const programId of programs) {
      const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId });
      tokenAccounts.push(...value);
    }

    // NFT-like: amount = 1, decimals = 0 (position NFTs are supply 1, non-fungible)
    const nftLike = tokenAccounts.filter((a) => {
      const info = a.account.data.parsed?.info;
      const amt = info?.tokenAmount?.uiAmount;
      const dec = info?.tokenAmount?.decimals;
      return amt === 1 && dec === 0;
    });

    const positions: {
      mint: string;
      tokenAccount: string;
      name?: string;
      symbol?: string;
      updateAuthority?: string;
    }[] = [];

    for (const ta of nftLike) {
      const mintStr = ta.account.data.parsed.info.mint as string;
      const mint = new PublicKey(mintStr);
      const meta = await fetchMetadata(mint, connection);
      if (!meta) continue;

      if (looksLikeDbc(meta)) {
        positions.push({
          mint: mintStr,
          tokenAccount: ta.pubkey.toBase58(),
          name: meta.data?.name,
          symbol: meta.data?.symbol,
          updateAuthority: meta.updateAuthority?.toBase58?.(),
        });
      }
    }

  return NextResponse.json({ wallet: walletStr, positions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
  return NextResponse.json({ error: String(e) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
