import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import React, { useMemo } from 'react';
import { useWindowWidthListener } from '@/lib/device';

// Providers (SSR-safe) — mirror app/layout.tsx to support Pages Router prerender
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { UnifiedWalletProvider } from '@jup-ag/wallet-adapter';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { resolveRpc } from '@meteora-invent/shared-utils';
import { Toaster } from 'sonner';

// Resolve client RPC endpoint with a safe fallback during SSR
let CLIENT_RPC_ENDPOINT: string;
try {
  CLIENT_RPC_ENDPOINT = resolveRpc();
} catch {
  CLIENT_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
}

export default function App({ Component, pageProps }: AppProps) {
  // Optional responsive listener used by the rest of your app
  useWindowWidthListener();

  // Initialize wallets lazily and SSR-safe
  const wallets: any[] = useMemo<any[]>(() => {
    try {
      const list: any[] = [new PhantomWalletAdapter(), new SolflareWalletAdapter()].filter(
        (w: any) => w && w.name && w.icon
      );
      return list;
    } catch {
      return [];
    }
  }, []);

  const queryClient = useMemo(() => new QueryClient(), []);

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
