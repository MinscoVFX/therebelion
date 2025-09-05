import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { z } from 'zod';
import Header from '../components/Header';

import * as ReactForm from '@tanstack/react-form'; // <= import the namespace
const useFormAny = (ReactForm as any).useForm as any; // <= alias as any to avoid generic arity errors

import { Button } from '@/components/ui/button';
import { Keypair, Transaction } from '@solana/web3.js';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { toast } from 'sonner';

// ---------------- Validation schema ----------------
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

// ---------------- Helpers ----------------
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

// ---------------- Page ----------------
export default function CreatePool() {
  const { publicKey, signTransaction } = useWallet();
  const address = useMemo(() => publicKey?.toBase58(), [publicKey]);

  const [isLoading, setIsLoading] = useState(false);
  const [poolCreated, setPoolCreated] = useState(false);

  // Use the any-aliased hook (NO generics)
  const form = useFormAny({
    defaultValues: {
      tokenName: '',
      tokenSymbol: '',
      tokenLogo: undefined as File | undefined,
      website: '',
      twitter: '',
      vanitySuffix: '',
      devPrebuy: false,
      devAmountSol: '',
    },
    onSubmit: async ({ value }: any) => {
      try {
        setIsLoading(true);

        const tokenLogo = value.tokenLogo as File | undefined;
        if (!tokenLogo) {
          toast.error('Token logo is required');
          return;
        }

        if (!signTransaction || !publicKey) {
          toast.error('Wallet not connected');
          return;
        }

        // Convert logo file to base64
        const base64File = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) ?? '');
          reader.readAsDataURL(tokenLogo);
        });

        // Vanity mint (optional)
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

        // Step 1: Ask backend to upload assets and build CREATE-ONLY tx (fees + memo inside)
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
            // passed for compatibility; /api/upload ignores them for tx building
            devPrebuy: !!value.devPrebuy,
            devAmountSol: value.devAmountSol || '',
          }),
        });

        const uploadJson = await uploadResponse.json();
        if (!uploadResponse.ok || !uploadJson?.poolTx) {
          throw new Error(uploadJson?.error || 'Upload/build failed');
        }

        const { poolTx } = uploadJson as { poolTx: string };

        // Step 2: Decode tx, sign with mint authority (keyPair), then user wallet
        const transaction = Transaction.from(Buffer.from(poolTx, 'base64'));
        transaction.sign(keyPair);

        const signedTransaction = await signTransaction(transaction);

        // Step 3: Send signed transaction (server validates creation fees)
        const sendResponse = await fetch('/api/send-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signedTransaction: signedTransaction.serialize().toString('base64'),
          }),
        });

        const sendJson = await sendResponse.json();
        if (!sendResponse.ok || !sendJson?.success) {
          throw new Error(sendJson?.error || 'Send failed');
        }

        toast.success('Pool created successfully');
        setPoolCreated(true);
      } catch (error) {
        console.error('Error creating pool:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to create pool');
      } finally {
        setIsLoading(false);
      }
    },
    validators: {
      onSubmit: ({ value }: any) => {
        const result = poolSchema.safeParse(value);
        if (!result.success) {
          return result.error.formErrors.fieldErrors as any;
        }
        return undefined;
      },
    },
  });

  return (
    <>
      <Head>
        <title>Create Pool - Virtual Curve</title>
        <meta
          name="description"
          content="Create a new token pool on Virtual Curve with customizable price curves."
        />
      </Head>

      <div className="min-h-screen bg-gradient-to-b text-white">
        {/* Header */}
        <Header />

        {/* Page Content */}
        <main className="container mx-auto px-4 py-10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10">
            <div>
              <h1 className="text-4xl font-bold mb-2">Create Pool</h1>
              <p className="text-gray-300">Launch your token with a customizable price curve</p>
            </div>
          </div>

        {poolCreated && !isLoading ? (
          <PoolCreationSuccess />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="space-y-8"
          >
            {/* Token Details Section */}
            <div className="bg-white/5 rounded-xl p-8 backdrop-blur-sm border border-white/10">
              <h2 className="text-2xl font-bold mb-4">Token Details</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="mb-4">
                    <label htmlFor="tokenName" className="block text-sm font-medium text-gray-300 mb-1">
                      Token Name*
                    </label>
                    {form.Field({
                      name: 'tokenName',
                      children: (field: any) => (
                        <input
                          id="tokenName"
                          name={field.name}
                          type="text"
                          className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                          placeholder="e.g. Virtual Coin"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          required
                          minLength={3}
                        />
                      ),
                    })}
                  </div>

                  <div className="mb-4">
                    <label htmlFor="tokenSymbol" className="block text sm font-medium text-gray-300 mb-1">
                      Token Symbol*
                    </label>
                    {form.Field({
                      name: 'tokenSymbol',
                      children: (field: any) => (
                        <input
                          id="tokenSymbol"
                          name={field.name}
                          type="text"
                          className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                          placeholder="e.g. VRTL"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          required
                          maxLength={10}
                        />
                      ),
                    })}
                  </div>

                  <div className="mb-4">
                    <label htmlFor="vanitySuffix" className="block text-sm font-medium text-gray-300 mb-1">
                      Vanity Suffix (optional)
                    </label>
                    {form.Field({
                      name: 'vanitySuffix',
                      children: (field: any) => (
                        <input
                          id="vanitySuffix"
                          name={field.name}
                          type="text"
                          className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                          placeholder="e.g. INU or AI"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          maxLength={4}
                        />
                      ),
                    })}
                    <p className="text-xs text-gray-400 mt-1">
                      1–4 base58 characters. We’ll search for a mint address ending with this.
                    </p>
                  </div>
                </div>

                <div>
                  <label htmlFor="tokenLogo" className="block text-sm font-medium text-gray-300 mb-1">
                    Token Logo*
                  </label>

                  {form.Field({
                    name: 'tokenLogo' as any, // relax field name typing for File
                    children: (field: any) => (
                      <div className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center">
                        <span className="iconify w-6 h-6 mx-auto mb-2 text-gray-400 ph--upload-bold" />
                        <p className="text-gray-400 text-xs mb-2">PNG, JPG or SVG (max. 2MB)</p>
                        <input
                          type="file"
                          id="tokenLogo"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              field.handleChange(file as any);
                            }
                          }}
                        />
                        <label
                          htmlFor="tokenLogo"
                          className="bg-white/10 px-4 py-2 rounded-lg text-sm hover:bg-white/20 transition cursor-pointer"
                        >
                          Browse Files
                        </label>
                      </div>
                    ),
                  })}
                </div>
              </div>
            </div>

            {/* Social Links Section */}
            <div className="bg-white/5 rounded-xl p-8 backdrop-blur-sm border border-white/10">
              <h2 className="text-2xl font-bold mb-6">Social Links (Optional)</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="mb-4">
                  <label htmlFor="website" className="block text-sm font-medium text-gray-300 mb-1">
                    Website
                  </label>
                  {form.Field({
                    name: 'website',
                    children: (field: any) => (
                      <input
                        id="website"
                        name={field.name}
                        type="url"
                        className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                        placeholder="https://yourwebsite.com"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    ),
                  })}
                </div>

                <div className="mb-4">
                  <label htmlFor="twitter" className="block text-sm font-medium text-gray-300 mb-1">
                    Twitter
                  </label>
                  {form.Field({
                    name: 'twitter',
                    children: (field: any) => (
                      <input
                        id="twitter"
                        name={field.name}
                        type="url"
                        className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                        placeholder="https://twitter.com/yourusername"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    ),
                  })}
                </div>
              </div>
            </div>

            {/* Dev Pre-Buy (Optional) */}
            <div className="bg-white/5 rounded-xl p-8 backdrop-blur-sm border border-white/10">
              <h2 className="text-2xl font-bold mb-6">Dev Pre-Buy (Optional)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center gap-3">
                  {form.Field({
                    name: 'devPrebuy',
                    children: (field: any) => (
                      <input
                        id="devPrebuy"
                        name={field.name}
                        type="checkbox"
                        className="h-5 w-5 accent-white/80"
                        checked={!!field.state.value}
                        onChange={(e) => field.handleChange(e.currentTarget.checked)}
                      />
                    ),
                  })}
                  <label htmlFor="devPrebuy" className="text-sm text-gray-300">
                    Buy with my wallet right after launch
                  </label>
                </div>

                <div>
                  <label htmlFor="devAmountSol" className="block text-sm font-medium text-gray-300 mb-1">
                    Amount (SOL)
                  </label>
                  {form.Field({
                    name: 'devAmountSol',
                    children: (field: any) => (
                      <input
                        id="devAmountSol"
                        name={field.name}
                        type="number"
                        min="0"
                        step="0.001"
                        placeholder="0.25"
                        className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        disabled={!Boolean((form as any).state?.values?.devPrebuy)}
                      />
                    ),
                  })}
                  <p className="text-xs text-gray-400 mt-1">
                    We’ll execute a buy inside the same transaction.
                  </p>
                </div>
              </div>
            </div>

            {(form as any).state?.errors && (form as any).state?.errors.length > 0 && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 space-y-2">
                {(form as any).state.errors.map((error: any, index: number) =>
                  Object.entries(error || {}).map(([, value]) => (
                    <div key={index} className="flex items-start gap-2">
                      <p className="text-red-200">
                        {Array.isArray(value)
                          ? (value as any[]).map((v) => (v as any).message || v).join(', ')
                          : typeof value === 'string'
                            ? value
                            : String(value)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

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
    return (
      <Button type="button" onClick={() => setShowModal(true)}>
        <span>Connect Wallet</span>
      </Button>
    );
  }

  return (
    <Button className="flex items-center gap-2" type="submit" disabled={isSubmitting}>
      {isSubmitting ? (
        <>
          <span className="iconify ph--spinner w-5 h-5 animate-spin" />
          <span>Creating Pool...</span>
        </>
      ) : (
        <>
          <span className="iconify ph--rocket-bold w-5 h-5" />
          <span>Launch Pool</span>
        </>
      )}
    </Button>
  );
};

const PoolCreationSuccess = () => {
  return (
    <>
      <div className="bg-white/5 rounded-xl p-8 backdrop-blur-sm border border-white/10 text-center">
        <div className="bg-green-500/20 p-4 rounded-full inline-flex mb-6">
          <span className="iconify ph--check-bold w-12 h-12 text-green-500" />
        </div>
        <h2 className="text-3xl font-bold mb-4">Pool Created Successfully!</h2>
        <p className="text-gray-300 mb-8 max-w-lg mx-auto">
          Your token pool has been created and is now live on the Virtual Curve platform. Users can
          now buy and trade your tokens.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/explore-pools"
            className="bg-white/10 px-6 py-3 rounded-xl font-medium hover:bg-white/20 transition"
          >
            Explore Pools
          </Link>
          <button
            onClick={() => {
              window.location.reload();
            }}
            className="cursor-pointer bg-gradient-to-r from-pink-500 to-purple-500 px-6 py-3 rounded-xl font-medium hover:opacity-90 transition"
          >
            Create Another Pool
          </button>
        </div>
      </div>
    </>
  );
};
