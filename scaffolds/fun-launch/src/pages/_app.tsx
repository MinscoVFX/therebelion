import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import React from 'react';
import { useWindowWidthListener } from '@/lib/device';

// Keep the pages/_app minimal: the App Router's `app/layout.tsx` provides global
// providers (ConnectionProvider, UnifiedWalletProvider, React Query). Having
// both register wallets causes duplicate Phantom registration warnings in the
// console. Render pages normally here to avoid double-provider registration.
export default function App({ Component, pageProps }: AppProps) {
  useWindowWidthListener();
  return <Component {...pageProps} />;
}
