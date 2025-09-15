export function resolveRpc(): string {
  const rpc = process.env.RPC_ENDPOINT || process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpc) throw new Error('RPC endpoint missing (RPC_ENDPOINT/RPC_URL/NEXT_PUBLIC_RPC_URL)');
  return rpc;
}
