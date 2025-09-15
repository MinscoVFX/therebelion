'use client';

import '@/styles/globals.css';
import React, { useMemo } from 'react';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { UnifiedWalletProvider } from '@jup-ag/wallet-adapter';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import { useWindowWidthListener } from '@/lib/device';

/**
 * Client RPC endpoint. Set NEXT_PUBLIC_RPC_URL in Vercel to match server RPC_URL.
 * Falls back to mainnet public RPC if not set.
 */
const CLIENT_RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Initialize empty wallets array to avoid dependency issues
  const wallets = useMemo(() => [], []);

  // React Query client
  const queryClient = useMemo(() => new QueryClient(), []);

  // Optional responsive listener used by the rest of your app
  useWindowWidthListener();

  return (
    <html lang="en">
      <body>
        <QueryClientProvider client={queryClient}>
          <ConnectionProvider endpoint={CLIENT_RPC_ENDPOINT}>
            <WalletProvider wallets={wallets} autoConnect>
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
                {children}
              </UnifiedWalletProvider>
            </WalletProvider>
          </ConnectionProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
