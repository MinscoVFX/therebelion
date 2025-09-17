import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import React, { useMemo } from 'react';

import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { Adapter, UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { useWindowWidthListener } from '@/lib/device';
import { resolveRpc } from '@meteora-invent/shared-utils';

/**
 * Client RPC endpoint. Set NEXT_PUBLIC_RPC_URL in Vercel to match server RPC_URL.
 * Falls back to mainnet public RPC if not set.
 */
let CLIENT_RPC_ENDPOINT: string;
try {
  CLIENT_RPC_ENDPOINT = resolveRpc();
} catch {
  CLIENT_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
}

export default function App({ Component, pageProps }: AppProps) {
  // Initialize wallets once
  const wallets: Adapter[] = useMemo(() => {
    return [new PhantomWalletAdapter(), new SolflareWalletAdapter()].filter(
      (item) => item && (item as any).name && (item as any).icon
    ) as Adapter[];
  }, []);

  // React Query client
  const queryClient = useMemo(() => new QueryClient(), []);

  // Optional responsive listener used by the rest of your app
  useWindowWidthListener();

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={CLIENT_RPC_ENDPOINT}>
        <UnifiedWalletProvider
          wallets={wallets}
          config={{
            env: 'mainnet-beta',
            autoConnect: true,
            metadata: {
              name: 'UnifiedWallet',
              description: 'UnifiedWallet',
              url: 'https://jup.ag',
              iconUrls: ['https://jup.ag/favicon.ico'],
            },
            theme: 'dark',
            lang: 'en',
          }}
        >
          {/* Global toast portal */}
          <Toaster richColors position="top-right" />
          <Component {...pageProps} />
        </UnifiedWalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
