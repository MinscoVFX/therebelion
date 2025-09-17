import crypto from 'crypto';
import { createRequire } from 'module';
import { PublicKey } from '@solana/web3.js';

export interface AnchorIdlInstruction {
  name: string;
  accounts?: { name: string; isMut?: boolean; isSigner?: boolean; pda?: any }[];
  args?: any[];
}
export interface AnchorIdlLike {
  version?: string;
  name?: string;
  instructions?: AnchorIdlInstruction[];
  metadata?: any;
  address?: string; // optional top-level program id
}

export function anchorInstructionDiscriminator(ixName: string): Buffer {
  const preimage = `global::${ixName}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.subarray(0, 8);
}

export interface ResolvedInstructionMeta {
  name: string;
  discriminator: Buffer;
  accounts: string[];
}
export interface DbcIdlResolution {
  programId?: PublicKey;
  instructions: ResolvedInstructionMeta[];
}

export function resolveDbcIdl(idl: AnchorIdlLike): DbcIdlResolution {
  const instructions: ResolvedInstructionMeta[] = [];
  for (const ix of idl.instructions || []) {
    instructions.push({
      name: ix.name,
      discriminator: anchorInstructionDiscriminator(ix.name),
      accounts: (ix.accounts || []).map((a) => a.name),
    });
  }
  let programId: PublicKey | undefined;
  const addr = idl.metadata?.address || idl.address;
  if (addr) {
    try {
      programId = new PublicKey(addr);
    } catch {
      /* ignore invalid */
    }
  }
  return { programId, instructions };
}

let _cached: DbcIdlResolution | null = null;
// Sync loader using createRequire to avoid direct CommonJS require usage in ESM userland.
export function loadDbcIdlIfAvailable(): DbcIdlResolution | null {
  if (_cached) return _cached;
  try {
    const requireFn = createRequire(import.meta.url);
    // Path adjusted one level up (server dir -> src -> fun-launch -> scaffolds -> repo root)
    const idl: AnchorIdlLike = requireFn('../../../../dbc_idl.json');
    _cached = resolveDbcIdl(idl);
    return _cached;
  } catch {
    return null;
  }
}
