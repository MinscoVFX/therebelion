"use client";
import React from 'react';
import { useDbcPools } from '@/context/DbcPoolContext';
import { toast } from 'sonner';

export const DbcPoolSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { pools, selected, setSelectedId, loading, error, refresh } = useDbcPools();

  if (error) {
    // surface error once
    console.warn('[DbcPoolSelector] pool discovery error:', error);
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs font-medium text-gray-600">DBC Pool</label>
      <div className="flex items-center gap-2">
        <select
          value={selected === 'ALL' ? 'ALL' : (selected?.id || '')}
          onChange={(e) => setSelectedId(e.target.value as any)}
          disabled={loading}
          className="border rounded px-2 py-1 text-sm bg-white disabled:bg-gray-100"
        >
          {pools.length > 1 && <option value="ALL">All Pools ({pools.length})</option>}
          {pools.map(p => {
            const tags = p.tags || [];
            // Derive badge priority: discovered+lpMint => decoded, nft => nft, else first tag
            let badge = '';
            if (tags.includes('nft')) badge = 'nft';
            if (tags.includes('discovered') && p.lpMint) badge = 'decoded';
            if (!badge && tags.length) badge = tags[0] || '';
            const suffix = badge ? ` [${badge}]` : '';
            return (
              <option key={p.id} value={p.id}>
                {p.label}{suffix}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          onClick={() => refresh().then(()=>toast.success('Pools refreshed'))}
          disabled={loading}
          className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? '...' : '↻'}
        </button>
      </div>
      {error && (
        <span className="text-[10px] text-red-600">{error}</span>
      )}
    </div>
  );
};
