/**
 * Resolve the Solana RPC endpoint from a prioritized list of env vars.
 * Order: RPC_ENDPOINT > RPC_URL > NEXT_PUBLIC_RPC_URL.
 * Throws a descriptive error if none are set to avoid silent fallbacks.
 */
export function resolveRpc(): string {
  const endpoint =
    process.env.RPC_ENDPOINT || process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  if (!endpoint) {
    throw new Error(
      'Missing RPC endpoint: set one of RPC_ENDPOINT, RPC_URL, or NEXT_PUBLIC_RPC_URL'
    );
  }
  return endpoint;
}
