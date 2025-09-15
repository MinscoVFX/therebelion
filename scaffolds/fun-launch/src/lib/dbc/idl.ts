import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type AnchorIdl = {
  name: string;
  version: string;
  instructions: { name: string }[];
  metadata?: { address?: string };
};

export function deriveAnchorDiscriminator(ixName: string): Buffer {
  const preimage = `global::${ixName}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.subarray(0, 8);
}

export function loadDbcIdl(): AnchorIdl | null {
  try {
    // fun-launch/src/lib/dbc -> fun-launch/src -> fun-launch -> scaffolds -> repo root
    const root = path.resolve(process.cwd(), '..', '..');
    const candidate = path.join(root, 'dbc_idl.json');
    if (!fs.existsSync(candidate)) return null;
    const raw = fs.readFileSync(candidate, 'utf8');
    const idl = JSON.parse(raw);
    if (!idl?.instructions?.length) return null;
    return idl;
  } catch {
    return null;
  }
}

export function getClaimIxNameFromIdl(idl: AnchorIdl): string | null {
  const names = idl.instructions.map(i => i.name);
  if (names.includes('claim_partner_trading_fee')) return 'claim_partner_trading_fee';
  if (names.includes('claim_creator_trading_fee')) return 'claim_creator_trading_fee';
  // fallback: find any instruction containing claim & fee
  const fuzzy = names.find(n => /claim/.test(n) && /fee/.test(n));
  return fuzzy || null;
}
