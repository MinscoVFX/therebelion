import { useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { z } from 'zod';
import Header from '../components/Header';

import { useForm } from '@tanstack/react-form';
import { Button } from '@/components/ui/button';
import { Keypair, Transaction, PublicKey, SystemProgram } from '@solana/web3.js';
import { useUnifiedWalletContext, useWallet } from '@jup-ag/wallet-adapter';
import { toast } from 'sonner';

// ---------- helpers ----------
async function getJitoTipAccounts(): Promise<string[]> {
  const r = await fetch('/api/jito-bundle?tipAccounts=1', { method: 'GET' });
  if (!r.ok) throw new Error(`Failed to fetch Jito tip accounts (HTTP ${r.status})`);
  const j = await r.json();
  const list = j?.tipAccounts;
  if (!Array.isArray(list) || list.length === 0) throw new Error('No Jito tip accounts returned');
  return list as string[];
}

// Define the schema for form validation
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

// helpers for vanity search
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
  const [awaitingWallet, setAwaitingWallet] = useState(false); // lock while Phantom is open
  const [poolCreated, setPoolCreated] = useState(false);
  const devAmountSnapRef = useRef<string>(''); // snapshot at click/submit

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
      // snapshot the dev amount the moment we submit (prevents edits during wallet prompts)
      devAmountSnapRef.current = value.devAmountSol || '';

      try {
        setIsLoading(true);
        const { tokenLogo } = value;
        if (!tokenLogo) {
          toast.error('Token logo is required');
          return;
        }

        if (!publicKey || !signTransaction) {
          toast.error('Wallet not connected');
          return;
        }
        // ---- narrow once and reuse (fix TS) ----
        const walletPk: PublicKey = publicKey;
        const addressStr: string = walletPk.toBase58();

        const reader = new FileReader();
        // Convert file to base64
        const base64File = await new Promise<string>((resolve) => {
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(tokenLogo);
        });

        // vanity mint (optional)
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

        // STEP 1: build create tx on backend (NO swap inside; we bundle separately)
        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenLogo: base64File,
            mint: keyPair.publicKey.toBase58(),
            tokenName: value.tokenName,
            tokenSymbol: value.tokenSymbol,
            userWallet: addressStr, // narrowed string
            website: value.website || '',
            twitter: value.twitter || '',
            // Important: let server build ONLY the create tx (we handle dev-buy separately)
            devPrebuy: false,
            devAmountSol: '',
          }),
        });

        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok || !uploadJson?.poolTx) {
          throw new Error(uploadJson?.error || 'Upload/build failed');
        }

        const { poolTx, pool } = uploadJson as { poolTx: string; pool?: string };

        // Decode tx
        const createTx = Transaction.from(Buffer.from(poolTx, 'base64'));
        // Sign with mint keypair (mint authority)
        createTx.sign(keyPair);
        // Then sign with user's wallet (payer)
        setAwaitingWallet(true);
        const signedCreate = await signTransaction(createTx);
        setAwaitingWallet(false);
        const signedCreateB64 = Buffer.from(signedCreate.serialize()).toString('base64');

        // If Dev Pre-Buy is requested, build a separate swap and sign it
        let signedSwapB64: string | undefined = undefined;
        const doDevBuy = !!value.devPrebuy && Number(devAmountSnapRef.current) > 0;

        if (doDevBuy) {
          const buildSwapRes = await fetch('/api/build-swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseMint: keyPair.publicKey.toBase58(),
              payer: addressStr, // narrowed string
              amountSol: devAmountSnapRef.current, // snapshot
              pool: pool || undefined,             // if upload returned pool, use it
              slippageBps: 100,
            }),
          });
          const buildSwapJson = await buildSwapRes.json();
          if (!buildSwapRes.ok || !buildSwapJson?.swapTx) {
            throw new Error(buildSwapJson?.error || 'Failed to build swap');
          }

          const swapTx = Transaction.from(Buffer.from(buildSwapJson.swapTx, 'base64'));
          if (!swapTx.feePayer) swapTx.feePayer = walletPk; // narrowed PublicKey

          // ---- Add a small Jito tip to this swap tx (so bundle has a tip) ----
          try {
            const tipAccounts = await getJitoTipAccounts();
            const tipTo = new PublicKey(String(tipAccounts[0])); // ensure string
            // 10_000 lamports (~0.00001 SOL). Adjust if you want.
            const TIP_LAMPORTS = 10_000;
            swapTx.add(
              SystemProgram.transfer({
                fromPubkey: walletPk, // narrowed PublicKey
                toPubkey: tipTo,
                lamports: TIP_LAMPORTS,
              })
            );
          } catch (e) {
            // Non-fatal: if tip fetch fails, continue (bundle may still land without it)
            console.warn('Tip append skipped:', e);
          }

          setAwaitingWallet(true);
          const signedSwap = await signTransaction(swapTx);
          setAwaitingWallet(false);

          signedSwapB64 = Buffer.from(signedSwap.serialize()).toString('base64');
        }

        // STEP 2: submit (bundle if dev-buy, else single)
        if (doDevBuy && signedSwapB64) {
          // Submit both back-to-back (pump.fun-style) via send-transaction bundle path
          const sendRes = await fetch('/api/send-transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              signedTransactions: [signedCreateB64, signedSwapB64],
              waitForLanded: true,
            }),
          });
          const sendJson = await sendRes.json();
          if (!sendRes.ok || !sendJson?.success) {
            throw new Error(sendJson?.error || 'Bundle submission failed');
          }
          toast.success(`Bundle submitted${sendJson?.status ? `: ${sendJson.status}` : ''}`);
        } else {
          // Single create tx path (preserves your creation-fee validation on server)
          const sendResponse = await fetch('/api/send-transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signedTransaction: signedCreateB64 }),
          });
          const sendJson = await sendResponse.json();
          if (!sendResponse.ok || !sendJson?.success) {
            throw new Error(sendJson?.error || 'Send failed');
          }
        }

        toast.success('Pool created successfully');
        setPoolCreated(true);
      } catch (error) {
        console.error('Error creating pool:', error);
        // always clear wallet-await lock on errors/cancel
        setAwaitingWallet(false);
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

  // lock inputs while busy or wallet prompt open
  const formLocked = isLoading || awaitingWallet;

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
                if (formLocked) return;
                form.handleSubmit();
              }}
              className={`space-y-8 ${awaitingWallet ? 'pointer-events-none opacity-60' : ''}`}
            >
              {/* Token Details Section */}
              <div className="bg-white/5 rounded-xl p-8 backdrop-blur-sm border border-white/10">
                <h2 className="text-2xl font-bold mb-4">Token Details</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="mb-4">
                      <label
                        htmlFor="tokenName"
                        className="block text-sm font-medium text-gray-300 mb-1"
                      >
                        Token Name*
                      </label>
                      {form.Field({
                        name: 'tokenName',
                        children: (field) => (
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
                            disabled={formLocked}
                          />
                        ),
                      })}
                    </div>

                    <div className="mb-4">
                      <label
                        htmlFor="tokenSymbol"
                        className="block text-sm font-medium text-gray-300 mb-1"
                      >
                        Token Symbol*
                      </label>
                      {form.Field({
                        name: 'tokenSymbol',
                        children: (field) => (
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
                            disabled={formLocked}
                          />
                        ),
                      })}
                    </div>

                    <div className="mb-4">
                      <label
                        htmlFor="vanitySuffix"
                        className="block text-sm font-medium text-gray-300 mb-1"
                      >
                        Vanity Suffix (optional)
                      </label>
                      {form.Field({
                        name: 'vanitySuffix',
                        children: (field) => (
                          <input
                            id="vanitySuffix"
                            name={field.name}
                            type="text"
                            className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                            placeholder="e.g. INU or AI"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            maxLength={4}
                            disabled={formLocked}
                          />
                        ),
                      })}
                      <p className="text-xs text-gray-400 mt-1">
                        1–4 base58 characters. We’ll search for a mint address ending with this.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="tokenLogo"
                      className="block text-sm font-medium text-gray-300 mb-1"
                    >
                      Token Logo*
                    </label>
                    {form.Field({
                      name: 'tokenLogo',
                      children: (field) => (
                        <div className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center">
                          <span className="iconify w-6 h-6 mx-auto mb-2 text-gray-400 ph--upload-bold" />
                          <p className="text-gray-400 text-xs mb-2">PNG, JPG or SVG (max. 2MB)</p>
                          <input
                            type="file"
                            id="tokenLogo"
                            className="hidden"
                            onChange={(e) => {
                              if (formLocked) return;
                              const file = e.target.files?.[0];
                              if (file) {
                                field.handleChange(file);
                              }
                            }}
                            disabled={formLocked}
                          />
                          <label
                            htmlFor="tokenLogo"
                            className={`bg-white/10 px-4 py-2 rounded-lg text-sm transition cursor-pointer ${formLocked ? 'opacity-60 pointer-events-none' : 'hover:bg-white/20'}`}
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
                    <label
                      htmlFor="website"
                      className="block text-sm font-medium text-gray-300 mb-1"
                    >
                      Website
                    </label>
                    {form.Field({
                      name: 'website',
                      children: (field) => (
                        <input
                          id="website"
                          name={field.name}
                          type="url"
                          className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                          placeholder="https://yourwebsite.com"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={formLocked}
                        />
                      ),
                    })}
                  </div>

                  <div className="mb-4">
                    <label
                      htmlFor="twitter"
                      className="block text-sm font-medium text-gray-300 mb-1"
                    >
                      Twitter
                    </label>
                    {form.Field({
                      name: 'twitter',
                      children: (field) => (
                        <input
                          id="twitter"
                          name={field.name}
                          type="url"
                          className="w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white"
                          placeholder="https://twitter.com/yourusername"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={formLocked}
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
                      children: (field) => (
                        <input
                          id="devPrebuy"
                          name={field.name}
                          type="checkbox"
                          className="h-5 w-5 accent-white/80"
                          checked={!!field.state.value}
                          onChange={(e) => field.handleChange(e.currentTarget.checked)}
                          disabled={formLocked}
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
                      children: (field) => {
                        const disabled = !Boolean(form.state.values?.devPrebuy) || formLocked;
                        return (
                          <input
                            key={disabled ? 'dev-off' : 'dev-on'} // forces remount to avoid browser quirks
                            id="devAmountSol"
                            name={field.name}
                            type="text"
                            inputMode="decimal"
                            placeholder="0.25"
                            className={`w-full p-3 bg-white/5 border border-white/10 rounded-lg text-white ${disabled ? 'opacity-60' : ''}`}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            disabled={disabled}
                          />
                        );
                      },
                    })}
                    <p className="text-xs text-gray-400 mt-1">We’ll execute a buy immediately after your pool is created.</p>
                  </div>
                </div>
              </div>

              {form.state.errors && form.state.errors.length > 0 && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 space-y-2">
                  {form.state.errors.map((error, index) =>
                    Object.entries(error || {}).map(([, value]) => (
                      <div key={index} className="flex items-start gap-2">
                        <p className="text-red-200">
                          {Array.isArray(value)
                            ? value.map((v: any) => v.message || v).join(', ')
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
                <SubmitButton isSubmitting={isLoading || awaitingWallet} awaitingWallet={awaitingWallet} />
              </div>
            </form>
          )}
        </main>
      </div>
    </>
  );
}

const SubmitButton = ({ isSubmitting, awaitingWallet }: { isSubmitting: boolean; awaitingWallet: boolean }) => {
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
          <span>{awaitingWallet ? 'Awaiting Wallet…' : 'Creating Pool...'}</span>
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
