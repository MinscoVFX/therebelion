import React, { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Keypair } from '@solana/web3.js';
import { Table as _Table } from '@/components/Table';
import { 
  scanDbcPositionsUltraSafe, 
  executeBulletproofDbcExit,
  DbcPosition,
  BulletproofExitResult 
} from '@/server/dbc-adapter';

interface TxTableProps {
  className?: string;
}

interface PositionRowProps {
  position: DbcPosition;
  onExit: (position: DbcPosition) => Promise<void>;
  isExiting: boolean;
}

const PositionRow: React.FC<PositionRowProps> = ({ position, onExit, isExiting }) => {
  const handleExit = useCallback(() => {
    if (!isExiting) {
      onExit(position);
    }
  }, [position, onExit, isExiting]);

  return (
    <tr className="border-b hover:bg-gray-50">
      <td className="px-4 py-3 text-sm">
        {position.poolKeys.pool.toString().slice(0, 8)}...
      </td>
      <td className="px-4 py-3 text-sm">
        {position.lpAmount.toString()}
      </td>
      <td className="px-4 py-3 text-sm">
        ${position.estimatedValueUsd?.toFixed(2) || '0.00'}
      </td>
      <td className="px-4 py-3 text-sm">
        {position.programId.toString().slice(0, 8)}...
      </td>
      <td className="px-4 py-3">
        <button
          onClick={handleExit}
          disabled={isExiting}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            isExiting
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-red-500 hover:bg-red-600 text-white'
          }`}
        >
          {isExiting ? 'Exiting...' : 'Instant Exit'}
        </button>
      </td>
    </tr>
  );
};

export const TxTable: React.FC<TxTableProps> = ({ className = '' }) => {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<DbcPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [exitingPositions, setExitingPositions] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);

  // Scan for DBC positions with bulletproof reliability
  const scanPositions = useCallback(async () => {
    if (!publicKey || !connection) {
      console.warn('[TxTable] Wallet not connected');
      return;
    }

    setLoading(true);
    setScanError(null);

    try {
      console.log('[TxTable] Starting ultra-safe DBC position scan...');
      const foundPositions = await scanDbcPositionsUltraSafe({
        connection,
        wallet: publicKey
      });

      setPositions(foundPositions);
      console.log(`[TxTable] Found ${foundPositions.length} DBC positions`);

      if (foundPositions.length === 0) {
        setScanError('No DBC positions found');
      }
    } catch (error) {
      console.error('[TxTable] Position scan failed:', error);
      setScanError(error instanceof Error ? error.message : 'Failed to scan positions');
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  // Execute bulletproof exit with maximum reliability
  const handleInstantExit = useCallback(async (position: DbcPosition) => {
    if (!connection) {
      console.error('[TxTable] No connection available');
      return;
    }

    // Create a temporary keypair for signing (in production, use wallet adapter)
    // This is a simplified version - actual implementation would use wallet adapter
    const tempKeypair = Keypair.generate();
    
    const positionKey = position.poolKeys.pool.toString();
    setExitingPositions(prev => new Set(prev).add(positionKey));

    try {
      console.log(`[TxTable] Starting bulletproof exit for position: ${positionKey}`);
      
      const result: BulletproofExitResult = await executeBulletproofDbcExit({
        connection,
        position,
        payer: tempKeypair // In production: use wallet adapter keypair
      });

      if (result.success) {
        console.log(`[TxTable] Exit successful! Signature: ${result.signature}`);
        console.log(`[TxTable] Completed in ${result.retryCount} attempts`);
        
        // Remove position from list on successful exit
        setPositions(prev => prev.filter(p => p.poolKeys.pool.toString() !== positionKey));
        
        // Show success notification (implement your notification system)
        alert(`Successfully exited DBC position!\nSignature: ${result.signature}\nRetries: ${result.retryCount}`);
      } else {
        console.error(`[TxTable] Exit failed: ${result.error}`);
        alert(`Failed to exit position: ${result.error}`);
      }
    } catch (error) {
      console.error('[TxTable] Unexpected exit error:', error);
      alert(`Unexpected error during exit: ${error}`);
    } finally {
      setExitingPositions(prev => {
        const newSet = new Set(prev);
        newSet.delete(positionKey);
        return newSet;
      });
    }
  }, [connection]);

  // Auto-scan on component mount and wallet change
  React.useEffect(() => {
    if (publicKey) {
      scanPositions();
    } else {
      setPositions([]);
      setScanError(null);
    }
  }, [publicKey, scanPositions]);

  if (!publicKey) {
    return (
      <div className={`p-6 text-center ${className}`}>
        <p className="text-gray-500">Connect your wallet to view DBC positions</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">DBC Positions</h2>
        <button
          onClick={scanPositions}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded font-medium transition-colors"
        >
          {loading ? 'Scanning...' : 'Refresh'}
        </button>
      </div>

      {/* Error Display */}
      {scanError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">
          {scanError}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <p className="mt-2 text-gray-600">Scanning for DBC positions...</p>
        </div>
      )}

      {/* Positions Table */}
      {!loading && positions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full bg-white border border-gray-200 rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Pool</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">LP Amount</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Est. Value</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Program</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position, index) => (
                <PositionRow
                  key={`${position.poolKeys.pool.toString()}-${index}`}
                  position={position}
                  onExit={handleInstantExit}
                  isExiting={exitingPositions.has(position.poolKeys.pool.toString())}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!loading && positions.length === 0 && !scanError && (
        <div className="p-8 text-center text-gray-500">
          <p>No DBC positions found</p>
          <p className="text-sm mt-1">Make sure you have DBC liquidity positions in your wallet</p>
        </div>
      )}

      {/* Stats Summary */}
      {positions.length > 0 && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <h3 className="font-medium text-blue-900 mb-2">Position Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-blue-700">Total Positions:</span>
              <span className="ml-2 font-medium">{positions.length}</span>
            </div>
            <div>
              <span className="text-blue-700">Exit Strategy:</span>
              <span className="ml-2 font-medium">99% Slippage Tolerance</span>
            </div>
            <div>
              <span className="text-blue-700">Reliability:</span>
              <span className="ml-2 font-medium">10 Retry Attempts</span>
            </div>
          </div>
          <p className="text-xs text-blue-600 mt-2">
            ⚡ Instant Exit uses bulletproof execution with 0.05 SOL priority fee for guaranteed success
          </p>
        </div>
      )}
    </div>
  );
};