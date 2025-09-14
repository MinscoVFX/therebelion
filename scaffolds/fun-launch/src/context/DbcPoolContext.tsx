"use client";
import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { DBC_POOLS, type DbcPoolInfo } from '@/constants/dbcPools';
import { useConnection } from '@solana/wallet-adapter-react';
import { useWallet } from '@jup-ag/wallet-adapter';
import { scanDbcPositionsUltraSafe, type DbcPosition, discoverMigratedDbcPoolsViaNfts, discoverMigratedDbcPoolsViaMetadata } from '@/server/dbc-adapter';

interface DbcPoolContextValue {
  pools: DbcPoolInfo[];
  selected?: DbcPoolInfo | 'ALL';
  setSelectedId: (id: string | 'ALL') => void;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
}

const Ctx = createContext<DbcPoolContextValue | undefined>(undefined);

export const DbcPoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [dynamicPools, setDynamicPools] = useState<DbcPoolInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | 'ALL' | undefined>(undefined);

  const buildPoolsFromPositions = useCallback((positions: DbcPosition[]): DbcPoolInfo[] => {
    const map = new Map<string, DbcPoolInfo>();
    for (const pos of positions) {
      const poolStr = pos.poolKeys.pool.toBase58();
      const feeStr = pos.poolKeys.feeVault.toBase58();
      const lpMintStr = pos.poolKeys.lpMint.toBase58();
      const userLpTokenStr = pos.poolKeys.userLpToken.toBase58();
      const existing = map.get(poolStr);
      if (existing) {
        existing.totalLpRaw = (existing.totalLpRaw ?? 0n) + pos.lpAmount;
        // Replace primaryUserLpToken if this position has the larger balance
        if (!existing.primaryUserLpToken || (pos.lpAmount > (existing.totalLpRaw ?? 0n))) {
          existing.primaryUserLpToken = userLpTokenStr;
        }
      } else {
        map.set(poolStr, {
          id: poolStr,
          label: `Pool ${poolStr.slice(0, 4)}…${poolStr.slice(-4)}`,
          pool: poolStr,
          feeVault: feeStr,
          tags: ['discovered'],
          totalLpRaw: pos.lpAmount,
          lpMint: lpMintStr,
          primaryUserLpToken: userLpTokenStr,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aLp = a.totalLpRaw ?? 0n;
      const bLp = b.totalLpRaw ?? 0n;
      if (aLp === bLp) return 0;
      return aLp > bLp ? -1 : 1; // descending
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!publicKey || !connection) {
      setDynamicPools(null);
      setSelectedId(undefined);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const positions = await scanDbcPositionsUltraSafe({ connection, wallet: publicKey });
      let pools = buildPoolsFromPositions(positions);

      // If no direct LPs or to augment, try NFT discovery heuristics
      const nftPoolsRuntime = await discoverMigratedDbcPoolsViaNfts({ connection, wallet: publicKey });
      const nftPoolsMeta = await discoverMigratedDbcPoolsViaMetadata({ connection, wallet: publicKey });
      const combinedNftKeys = [...nftPoolsRuntime, ...nftPoolsMeta.filter(pk => !nftPoolsRuntime.find(r => r.equals(pk)))];
      if (combinedNftKeys.length) {
        const existingIds = new Set(pools.map(p => p.id));
        for (const pk of combinedNftKeys) {
          const id = pk.toBase58();
            if (existingIds.has(id)) continue;
          pools.push({
            id,
            label: `Pool ${id.slice(0,4)}…${id.slice(-4)}`,
            pool: id,
            feeVault: id, // placeholder until decoded
            tags: ['nft'],
          });
        }
        // Keep sort (existing builder already sorted by LP). NFT-only pools go last.
      }

      if (!pools.length) {
        pools = DBC_POOLS;
      }
      setDynamicPools(pools);
      if (!selectedId || (selectedId !== 'ALL' && !pools.find(p => p.id === selectedId))) {
        setSelectedId(pools.length > 1 ? 'ALL' : (pools[0]?.id));
      }
    } catch (e: any) {
      setError(e?.message || 'Failed scanning DBC pools');
      if (!dynamicPools) {
        setDynamicPools(DBC_POOLS);
        if (!selectedId) setSelectedId(DBC_POOLS[0]?.id);
      }
    } finally {
      setLoading(false);
    }
  }, [publicKey, connection, buildPoolsFromPositions, selectedId, dynamicPools]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pools = dynamicPools ?? DBC_POOLS;
  const selected = useMemo(() => {
    if (selectedId === 'ALL') return 'ALL';
    return pools.find(p => p.id === selectedId);
  }, [pools, selectedId]);

  const value: DbcPoolContextValue = {
    pools,
    selected,
    setSelectedId: (id: string | 'ALL') => setSelectedId(id),
    loading,
    error,
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useDbcPools() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDbcPools must be used within DbcPoolProvider');
  return ctx;
}
