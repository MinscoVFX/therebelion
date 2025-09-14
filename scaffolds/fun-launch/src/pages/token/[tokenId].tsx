
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { TokenPageMsgHandler } from '@/components/Token/TokenPageMsgHandler';
import { TokenChart } from '@/components/TokenChart/TokenChart';
import { TokenDetails } from '@/components/TokenHeader/TokenDetail';
import { TokenHeader } from '@/components/TokenHeader/TokenHeader';
import { TokenStats } from '@/components/TokenHeader/TokenStats';
import { TokenBottomPanel } from '@/components/TokenTable';
import Page from '@/components/ui/Page/Page';
import { DataStreamProvider, useDataStream } from '@/contexts/DataStreamProvider';
import { TokenChartProvider } from '@/contexts/TokenChartProvider';
import { useTokenAddress, useTokenInfo } from '@/hooks/queries';

const Terminal = dynamic(() => import('@/components/Terminal'), { ssr: false });

function SwapWidget() {
  // Only run hook inside component
  const tokenId = useTokenAddress();
  if (!tokenId) return null;
  return <Terminal mint={tokenId} />;
}

function TokenPageWithContext() {
  // Only run hooks inside component
  const tokenId = useTokenAddress();
  const { data: poolId } = useTokenInfo((data) => data?.id);
  const { subscribeTxns, unsubscribeTxns, subscribePools, unsubscribePools } = useDataStream();

  useEffect(() => {
    if (!tokenId) return undefined;
    subscribeTxns([tokenId]);
    return () => unsubscribeTxns([tokenId]);
  }, [tokenId, subscribeTxns, unsubscribeTxns]);

  useEffect(() => {
    if (!poolId) return undefined;
    subscribePools([poolId]);
    return () => unsubscribePools([poolId]);
    // don't track tokenId to prevent data mismatch
  }, [poolId, subscribePools, unsubscribePools]);

  return (
    <Page>
      <TokenPageMsgHandler />
      <div className="max-h-screen">
        <div className="flex mb-4 rounded-lg border border-neutral-700 p-3">
          <TokenHeader className="max-sm:order-1" />
        </div>
        <div className="w-full h-full flex flex-col md:flex-row gap-4">
          <div className="flex flex-col gap-4 mb-8 max-sm:w-full lg:min-w-[400px] max-sm:order-3">
            <TokenDetails />
            <div>
              <SwapWidget />
            </div>
          </div>
          <div className={'border-neutral-850 w-full max-sm:order-2'}>
            <TokenStats key={`token-stats-${poolId}`} />
            <div className="flex flex-col h-[300px] lg:h-[500px] w-full">
              <TokenChartProvider>
                <TokenChart />
              </TokenChartProvider>
            </div>
            <TokenBottomPanel className="flex h-0 min-h-full flex-col overflow-hidden" />
          </div>
        </div>
      </div>
    </Page>
  );
}

export default function TokenPage() {
  // Only wrap in provider at top-level
  return (
    <DataStreamProvider>
      <TokenPageWithContext />
    </DataStreamProvider>
  );
}
