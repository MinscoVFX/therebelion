import React, { useState } from 'react';
import type { PoolKeys } from '../lib/meteora/universalExit';

interface UniversalExitButtonProps {
  owner: string;
  poolKeys: PoolKeys;
  priorityMicros?: number;
}

export const UniversalExitButton: React.FC<UniversalExitButtonProps> = ({
  owner,
  poolKeys,
  priorityMicros,
}) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExit = async () => {
    setLoading(true);
    setStatus(null);
    setTxid(null);
    setError(null);
    try {
      const res = await fetch('/api/dammv2/exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, poolKeys, priorityMicros }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        result?: { status?: string; txid?: string | null; error?: string };
        error?: string;
      };
      if (data.success && data.result?.status === 'success') {
        setStatus('Success!');
        setTxid(data.result.txid ?? null);
      } else {
        setStatus('Error');
        setError(data.result?.error || data.error || 'Unknown error');
      }
    } catch (err: unknown) {
      setStatus('Error');
      setError((err as Error)?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleExit}
        disabled={loading}
        style={{ padding: '10px 20px', fontSize: '16px' }}
      >
        {loading ? 'Processing...' : 'Universal Exit'}
      </button>
      {status && (
        <div style={{ marginTop: 10 }}>
          <strong>Status:</strong> {status}
          {txid && (
            <div>
              <strong>TxID:</strong>{' '}
              <a href={`https://solscan.io/tx/${txid}`} target="_blank" rel="noopener noreferrer">
                {txid}
              </a>
            </div>
          )}
          {error && (
            <div style={{ color: 'red' }}>
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
