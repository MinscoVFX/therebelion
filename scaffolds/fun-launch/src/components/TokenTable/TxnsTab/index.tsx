import { useTokenAddress, useTokenInfo } from '@/hooks/queries';
import { useInfiniteQuery } from '@tanstack/react-query';
import { memo as _memo, useEffect, useMemo, useState } from 'react';
import { ApeQueries } from '../../Explore/queries';
import { TxTable } from './TxTable';
import { columns } from './columns';
import { Tx } from '../../Explore/types';

interface TxnsTabProps {
  symbol?: string;
  data?: any;
  table?: any;
  walletAddress?: string;
}

export const TxnsTab: React.FC<TxnsTabProps> = ({ symbol, data, table, walletAddress }) => {
  const tokenId = useTokenAddress();
  const { data: tokenSymbol } = useTokenInfo((data) => data?.baseAsset.symbol);

  const [paused, setPaused] = useState<boolean>(false);
  const [pausedPage, setPausedPage] = useState<Tx[]>([]);

  // Fixing type assignment issues
  const {
    data: txData,
    isFetching,
    fetchNextPage,
    hasNextPage: _hasNextPageQuery,
  } = useInfiniteQuery({
    ...ApeQueries.tokenTxs({ id: tokenId || '' }),
    enabled: !!tokenId,
  });

  // Ensure symbol and paused have default values
  const symbolValue: string = symbol || tokenSymbol || '';
  const pausedValue: boolean = paused || false;
  const hasNextPage: boolean = Array.isArray(data) ? data.length > 0 : false; // Safe guard

  const allRows = useMemo(
    () => (txData && txData.pages ? txData.pages.flatMap((d) => d?.txs ?? []) : []),
    [txData]
  );

  // TODO: optimize re-renders, seems like tables re-render unnecessarily while paused
  useEffect(() => {
    if (paused) {
      return;
    }
    setPausedPage(txData?.pages[0]?.txs ?? []);
  }, [txData, paused]);

  const pausedRows = useMemo(() => {
    const fetchedPages =
      txData && txData.pages.length > 1 ? txData.pages.slice(1).flatMap((d) => d?.txs ?? []) : [];
    return [...pausedPage, ...fetchedPages];
  }, [txData, pausedPage]);

  // Don't render if tokenId is not available
  if (!tokenId) {
    return null;
  }

  return (
    <TxTable
      symbol={symbolValue}
      data={paused ? pausedRows : allRows}
      columns={columns}
      fetchNextPage={fetchNextPage}
      isFetching={isFetching}
      hasNextPage={hasNextPage}
      paused={pausedValue}
      setPaused={setPaused}
      table={table}
      walletAddress={walletAddress}
    />
  );
};

TxnsTab.displayName = 'TxnsTab';
