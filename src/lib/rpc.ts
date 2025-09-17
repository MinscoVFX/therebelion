import { Connection, Commitment } from '@solana/web3.js';

export function resolveRpc(): string {
  const rpc = process.env.RPC_ENDPOINT || process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpc) throw new Error('RPC missing: set RPC_ENDPOINT or RPC_URL or NEXT_PUBLIC_RPC_URL');
  return rpc;
}

export function makeConnection(commitment: Commitment = 'confirmed') {
  return new Connection(resolveRpc(), { commitment });
}
