import { useState, useMemo } from 'react';
import Head from 'next/head';
import Header from '../components/Header';
import { Button } from '@/components/ui/button';
import { useWallet } from '@jup-ag/wallet-adapter';
import { toast } from 'sonner';
import ky from 'ky';

interface ClaimFormData {
  poolAddress: string;
}

export default function Exit() {
  const { publicKey } = useWallet();
  const address = useMemo(() => publicKey?.toBase58(), [publicKey]);
  
  const [poolAddress, setPoolAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleClaim = async () => {
    if (!address) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!poolAddress.trim()) {
      toast.error('Please enter a pool address');
      return;
    }

    setIsLoading(true);

    try {
      const response = await ky.post('/api/dbc-exit', {
        json: {
          action: 'claim',
          poolAddress: poolAddress.trim(),
        },
      }).json<{ success: boolean; transactionSignature?: string; error?: string }>();

      if (response.success) {
        toast.success(`Fees claimed successfully! Transaction: ${response.transactionSignature}`);
        setPoolAddress(''); // Clear form
      } else {
        toast.error(response.error || 'Failed to claim fees');
      }
    } catch (error) {
      console.error('Claim error:', error);
      toast.error('Failed to claim fees. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Claim Fees - Fun Launch</title>
        <meta name="description" content="Claim your trading fees from DBC pools" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen flex flex-col bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
        <Header />
        
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20">
              <h1 className="text-2xl font-bold text-white mb-6 text-center">
                Claim Trading Fees
              </h1>
              
              <p className="text-white/80 text-sm mb-6 text-center">
                Claim your accumulated trading fees from DBC pools. 
                Only pool creators and partners can claim fees.
              </p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="poolAddress" className="block text-sm font-medium text-white mb-2">
                    Pool Address
                  </label>
                  <input
                    id="poolAddress"
                    type="text"
                    value={poolAddress}
                    onChange={(e) => setPoolAddress(e.target.value)}
                    placeholder="Enter DBC pool address"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={isLoading}
                  />
                </div>

                <Button
                  onClick={handleClaim}
                  disabled={isLoading || !address || !poolAddress.trim()}
                  className="w-full"
                >
                  {isLoading ? 'Claiming...' : 'Claim Fees'}
                </Button>

                {!address && (
                  <p className="text-yellow-400 text-sm text-center">
                    Please connect your wallet to claim fees
                  </p>
                )}
              </div>

              <div className="mt-6 p-4 bg-yellow-900/30 border border-yellow-500/30 rounded-lg">
                <p className="text-yellow-200 text-xs">
                  <strong>Note:</strong> Withdraw functionality is temporarily disabled 
                  until official layout integration is complete. Only fee claiming is available.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}