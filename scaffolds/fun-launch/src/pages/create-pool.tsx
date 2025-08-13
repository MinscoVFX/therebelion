import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { z } from 'zod';
import Header from '../components/Header';

import { useForm } from '@tanstack/react-form';
import { Button } from '@/components/ui/button';
import { Keypair, Transaction } from '@solana/web3.js';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { toast } from 'sonner';

// Form schema
const poolSchema = z.object({
  tokenName: z.string().min(3, 'Token name must be at least 3 characters'),
  tokenSymbol: z.string().min(1, 'Token symbol is required'),
  tokenLogo: z.instanceof(File, { message: 'Token logo is required' }).optional(),
  website: z.string().url({ message: 'Please enter a valid URL' }).optional().or(z.literal('')),
  twitter: z.string().url({ message: 'Please enter a valid URL' }).optional().or(z.literal('')),
  vanitySuffix: z
    .string()
    .max(4, 'Use 1–4 base58 chars')
    .regex(/^[1-9A-HJ-NP-Za-km-z]*$/, 'Only base58 (no 0,O,I,l)')
    .optional()
    .or(z.literal('')),
  devPrebuy: z.boolean().optional(),
  devAmountSol: z.string().optional().or(z.literal('')),
});

interface FormValues {
  tokenName: string;
  tokenSymbol: string;
  tokenLogo: File | undefined;
  website?: string;
  twitter?: string;
  vanitySuffix?: string;
  devPrebuy?: boolean;
  devAmountSol?: string;
}

function isBase58(str: string) {
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);
}

async function findVanityKeypair(suffix: string, maxSeconds = 30) {
  const deadline = Date.now() + maxSeconds * 1000;
  let tries = 0;
  while (Date.now() < deadline) {
    const kp = Keypair.generate();
    const addr = kp.publicKey.toBase58();
    tries++;
    if (addr.endsWith(suffix)) {
      return { kp, addr, tries, timedOut: false };
    }
    if (tries % 5000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { kp: null as any, addr: '', tries, timedOut: true };
}

export default function CreatePool() {
  const { publicKey, signTransaction } = useWallet();
  const address = useMemo(() => publicKey?.toBase58(), [publicKey]);

  const [isLoading, setIsLoading] = useState(false);
  const [poolCreated, setPoolCreated] = useState(false);

  const form = useForm({
    defaultValues: {
      tokenName: '',
      tokenSymbol: '',
      tokenLogo: undefined,
      website: '',
      twitter: '',
      vanitySuffix: '',
      devPrebuy: false,
      devAmountSol: '',
    } as FormValues,
    onSubmit: async ({ value }) => {
      try {
        setIsLoading(true);
        const { tokenLogo } = value;
        if (!tokenLogo) {
          toast.error('Token logo is required');
          return;
        }
        if (!signTransaction) {
          toast.error('Wallet not connected');
          return;
        }

        // Convert logo to base64
        const reader = new FileReader();
        const base64File = await new Promise<string>((resolve) => {
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(tokenLogo);
        });

        // Vanity address
        const rawSuffix = (value.vanitySuffix || '').trim();
        let keyPair: Keypair;
        if (rawSuffix.length > 0) {
          if (!isBase58(rawSuffix)) {
            toast.error('Suffix must be base58 (no 0, O, I, l).');
            return;
          }
          if (rawSuffix.length > 4) {
            toast.error('Suffix too long. Use up to 4 characters.');
            return;
          }
          toast.message(`Searching mint ending with “${rawSuffix}”...`);
          const { kp, addr, timedOut } = await findVanityKeypair(rawSuffix, 30);
          if (timedOut || !kp) {
            toast.message('No match found in time — using a normal address.');
            keyPair = Keypair.generate();
          } else {
            keyPair = kp;
            toast.success(`Found vanity mint: ${addr}`);
          }
        } else {
          keyPair = Keypair.generate();
        }

        // Step 1: Upload metadata to R2 and log CA
        const metadataRes = await fetch('/api/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: value.tokenName,
            symbol: value.tokenSymbol,
            description: '',
            imageUrl: base64File,
            twitter: value.twitter,
            website: value.website,
            attributes: [],
            ca: keyPair.publicKey.toBase58(),
          }),
        });

        if (!metadataRes.ok) {
          const err = await metadataRes.json();
          throw new Error(err.error || 'Metadata upload failed');
        }

        const { uri } = await metadataRes.json();

        // Step 2: Create pool transaction
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenLogo: base64File,
            mint: keyPair.publicKey.toBase58(),
            tokenName: value.tokenName,
            tokenSymbol: value.tokenSymbol,
            userWallet: address,
            website: value.website || '',
            twitter: value.twitter || '',
            devPrebuy: !!value.devPrebuy,
            devAmountSol: value.devAmountSol || '',
          }),
        });

        if (!uploadResponse.ok) {
          const error = await uploadResponse.json();
          throw new Error(error.error);
        }

        const { poolTx } = await uploadResponse.json();
        const transaction = Transaction.from(Buffer.from(poolTx, 'base64'));
        transaction.sign(keyPair);
        const signedTransaction = await signTransaction(transaction);

        const sendResponse = await fetch('/api/send-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransaction: signedTransaction.serialize().toString('base64'),
          }),
        });

        if (!sendResponse.ok) {
          const error = await sendResponse.json();
          throw new Error(error.error);
        }

        const { success } = await sendResponse.json();

        if (success) {
          // Step 3: Update on-chain metadata via API
          const updateRes = await fetch('/api/update-metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mint: keyPair.publicKey.toBase58(),
              metadataUri: uri,
              mintAuthority: Buffer.from(keyPair.secretKey).toString('base64'),
            }),
          });

          if (!updateRes.ok) {
            const err = await updateRes.json();
            throw new Error(err.error || 'On-chain metadata update failed');
          }

          toast.success('Pool created successfully');
          setPoolCreated(true);
        }
      } catch (error) {
        console.error('Error creating pool:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to create pool');
      } finally {
        setIsLoading(false);
      }
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = poolSchema.safeParse(value);
        if (!result.success) {
          return result.error.formErrors.fieldErrors;
        }
        return undefined;
      },
    },
  });

  return (
    <>
      <Head>
        <title>Create Pool - Virtual Curve</title>
        <meta name="description" content="Create a new token pool on Virtual Curve" />
      </Head>
      <div className="min-h-screen bg-gradient-to-b text-white">
        <Header />
        <main className="container mx-auto px-4 py-10">
          {poolCreated && !isLoading ? <PoolCreationSuccess /> : (
            <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-8">
              {/* token/social/dev fields go here */}
              <div className="flex justify-end">
                <SubmitButton isSubmitting={isLoading} />
              </div>
            </form>
          )}
        </main>
      </div>
    </>
  );
}

const SubmitButton = ({ isSubmitting }: { isSubmitting: boolean }) => {
  const { publicKey } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
  if (!publicKey) {
    return <Button type="button" onClick={() => setShowModal(true)}>Connect Wallet</Button>;
  }
  return (
    <Button type="submit" disabled={isSubmitting}>
      {isSubmitting ? 'Creating Pool...' : 'Launch Pool'}
    </Button>
  );
};

const PoolCreationSuccess = () => (
  <div className="text-center p-8 bg-white/5 rounded-xl">
    <h2 className="text-3xl font-bold mb-4">Pool Created!</h2>
    <p className="text-gray-300 mb-8">Your token is now live.</p>
    <Link href="/explore-pools" className="bg-white/10 px-6 py-3 rounded-xl">Explore Pools</Link>
  </div>
);
