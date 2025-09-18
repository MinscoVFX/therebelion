import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { z } from 'zod';
import Header from '../components/Header';

import * as ReactForm from '@tanstack/react-form';
const useFormAny = (ReactForm as any).useForm as any;

import { Button } from '@/components/ui/button';
import { Keypair, Transaction, PublicKey, SystemProgram } from '@solana/web3.js';
import { assertOnlyAllowedUnsignedSignersLegacy } from '@/lib/txSigners';
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

// (optional) fetch Jito tip accounts so at least one tx in the bundle has a tip
// Safe JSON parser: reads text then attempts JSON parse; returns fallback on empty
async function safeJson<T = any>(resp: Response, fallback: T | null = null): Promise<T | null> {
  const text = await resp.text().catch(() => '');
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function getJitoTipAccounts(): Promise<string[]> {
  const r = await fetch('/api/jito-bundle?tipAccounts=1', { method: 'GET' });
  if (!r.ok) throw new Error(`Failed to fetch Jito tip accounts (HTTP ${r.status})`);
  const j = await safeJson<{ tipAccounts?: unknown }>(r, {} as any);
  const list = (j as any)?.tipAccounts;
  if (!Array.isArray(list) || list.length === 0) throw new Error('No Jito tip accounts returned');
  return list as string[];
}

// ---------------- Page ----------------
export default function CreatePool() {
  const { publicKey, signTransaction } = useWallet();
  const address = useMemo(() => publicKey?.toBase58(), [publicKey]);

  const [isLoading, setIsLoading] = useState(false);
  const [poolCreated, setPoolCreated] = useState(false);

  const form = useFormAny({
    defaultValues: {
      tokenName: '',
      tokenSymbol: '',
      tokenLogo: undefined as File | undefined, // ensure key exists
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

        const uploadJson = await safeJson<{ poolTx?: string; pool?: string; error?: string }>(
          uploadResponse,
          null
        );
        if (!uploadResponse.ok || !uploadJson?.poolTx) {
          throw new Error(uploadJson?.error || 'Upload/build failed');
        }

        const { poolTx, pool } = uploadJson as { poolTx: string; pool?: string | null };

        // Step 2: Decode tx
        const createTx = Transaction.from(Buffer.from(poolTx, 'base64'));

        // Determine if the mint pubkey is actually a required signer in the message.
        const msgKeys = createTx.compileMessage().accountKeys;
        const mintIsSignerIndex = msgKeys.findIndex((k) => k.equals(keyPair.publicKey));

        if (mintIsSignerIndex !== -1) {
          // Use partialSign for non-wallet key first.
          createTx.partialSign(keyPair);
        } else {
          // Diagnostic only – mint may legitimately not be part of stub tx yet.
          console.warn(
            '[create-pool] Mint key not present as signer in returned tx; skipping mint partialSign'
          );
        }

        // Diagnostic: log which signers are expected and which have signatures BEFORE wallet signing.
        try {
          const preSignStatus = createTx.signatures.map((s, i) => ({
            index: i,
            key: msgKeys[i]?.toBase58(),
            hasSig: !!s.signature,
          }));
          // Only log in dev / preview to reduce noise in production (adjust as needed)
          if (process.env.NODE_ENV !== 'production') {
            console.log('[create-pool] Pre-wallet signer status', preSignStatus);
          }
        } catch {
          /* swallow signer status diagnostic failure */
        }

        // Validate that after partial signing (if any) only the wallet remains unsigned.
        try {
          assertOnlyAllowedUnsignedSignersLegacy(createTx, [publicKey]);
        } catch (e: any) {
          throw new Error(`Create transaction signer validation failed: ${e?.message || e}`);
        }

        const signedCreate = await signTransaction(createTx);
        // Post-sign diagnostics
        try {
          if (process.env.NODE_ENV !== 'production') {
            const postSignStatus = signedCreate.signatures.map((s, i) => ({
              index: i,
              key: msgKeys[i]?.toBase58(),
              hasSig: !!s.signature,
            }));
            console.log('[create-pool] Post-wallet signer status', postSignStatus);
          }
        } catch {
          /* swallow signer status diagnostic failure */
        }

        const signedCreateB64 = Buffer.from(signedCreate.serialize()).toString('base64');

        // Should we dev pre-buy (bundled)?
        const doDevBuy =
          !!value.devPrebuy &&
          typeof value.devAmountSol === 'string' &&
          Number(value.devAmountSol) > 0;

        if (doDevBuy) {
          if (!pool) {
            console.warn(
              'No pool returned from /api/upload; swap builder will still prelaunch-build.'
            );
          }

          // Step 2.5: Build the swap **in prelaunch mode** sharing the createTx blockhash
          const payerAddr = address || publicKey.toBase58();
          const buildSwapRes = await fetch('/api/build-swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseMint: keyPair.publicKey.toBase58(),
              payer: payerAddr,
              amountSol: value.devAmountSol,
              pool: pool || '',
              slippageBps: 100,
              prelaunch: true, // <-- IMPORTANT
              blockhash: String(createTx.recentBlockhash || ''), // share blockhash
            }),
          });
          const buildSwapJson = await safeJson<{ swapTx?: string; error?: string }>(
            buildSwapRes,
            null
          );
          if (!buildSwapRes.ok || !buildSwapJson?.swapTx) {
            throw new Error(buildSwapJson?.error || 'Failed to build swap');
          }

          const swapTx = Transaction.from(Buffer.from(buildSwapJson.swapTx, 'base64'));

          // (Optional) add a tiny Jito tip to the swap tx
          try {
            const tips = await getJitoTipAccounts().catch((): string[] => []);
            const firstTip: string | undefined = Array.isArray(tips)
              ? tips.find((t) => typeof t === 'string' && t.length > 0)
              : undefined;
            if (typeof firstTip === 'string') {
              const tipTo = new PublicKey(firstTip);
              const TIP_LAMPORTS = 10_000; // ~0.00001 SOL
              if (publicKey) {
                swapTx.add(
                  SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: tipTo,
                    lamports: TIP_LAMPORTS,
                  })
                );
              }
            }
          } catch (e) {
            console.warn('Skipping Jito tip append:', e);
          }

          try {
            assertOnlyAllowedUnsignedSignersLegacy(swapTx, [publicKey]);
          } catch (e: any) {
            throw new Error(`Swap transaction signer validation failed: ${e?.message || e}`);
          }
          const signedSwap = await signTransaction(swapTx);
          const signedSwapB64 = Buffer.from(signedSwap.serialize()).toString('base64');

          // Step 3: Submit both via bundle
          const sendRes = await fetch('/api/send-transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              signedTransactions: [signedCreateB64, signedSwapB64],
              waitForLanded: true,
            }),
          });
          const sendJson = await safeJson<{ success?: boolean; status?: string; error?: string }>(
            sendRes,
            null
          );
          if (!sendRes.ok || !sendJson?.success) {
            throw new Error(sendJson?.error || 'Bundle submission failed');
          }
          toast.success(`Bundle submitted${sendJson?.status ? `: ${sendJson.status}` : ''}`);
        } else {
          // Single create tx path (server validates creation-fee transfers)
          const sendResponse = await fetch('/api/send-transaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signedTransaction: signedCreateB64 }),
          });
          const sendJson = await safeJson<{ success?: boolean; error?: string }>(
            sendResponse,
            null
          );
          if (!sendResponse.ok || !sendJson?.success) {
            throw new Error(sendJson?.error || 'Send failed');
          }
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
  } as any);

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
                // ✅ DO NOT call hooks inside callbacks. Just use the instance we already created.
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
                      <label
                        htmlFor="tokenName"
                        className="block text-sm font-medium text-gray-300 mb-1"
                      >
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
                      <label
                        htmlFor="tokenSymbol"
                        className="block text-sm font-medium text-gray-300 mb-1"
                      >
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
                      <label
                        htmlFor="vanitySuffix"
                        className="block text-sm font-medium text-gray-300 mb-1"
                      >
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
                    <label
                      htmlFor="tokenLogo"
                      className="block text-sm font-medium text-gray-300 mb-1"
                    >
                      Token Logo*
                    </label>

                    {form.Field({
                      name: 'tokenLogo' as any, // relaxed typing for File input
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
                    <label
                      htmlFor="devAmountSol"
                      className="block text-sm font-medium text-gray-300 mb-1"
                    >
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
                          disabled={!(form as any).state?.values?.devPrebuy}
                        />
                      ),
                    })}
                    <p className="text-xs text-gray-400 mt-1">
                      We’ll execute a buy immediately after your pool is created (bundled).
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
            href="/"
            className="bg-white/10 px-6 py-3 rounded-xl font-medium hover:bg-white/20 transition"
          >
            Explore Pools
          </Link>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
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
