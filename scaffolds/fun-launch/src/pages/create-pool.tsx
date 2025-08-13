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

const poolSchema = z.object({
  tokenName: z.string().min(3, 'Token name must be at least 3 characters'),
  tokenSymbol: z.string().min(1, 'Token symbol is required'),
  tokenLogo: z.instanceof(File, { message: 'Token logo is required' }).optional(),
  website: z.string().url({ message: 'Please enter a valid URL' }).optional().or(z.literal('')),
  twitter: z.string().url({ message: 'Please enter a valid URL' }).optional().or(z.literal('')),
  vanitySuffix: z.string()
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
  tokenLogo?: File;
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
  while (Date.now() < deadline) {
    const kp = Keypair.generate();
    if (kp.publicKey.toBase58().endsWith(suffix)) {
      return { kp, addr: kp.publicKey.toBase58(), timedOut: false };
    }
  }
  return { kp: null, addr: '', timedOut: true };
}

export default function CreatePool() {
  const { publicKey, signTransaction } = useWallet();
  const { setShowModal } = useUnifiedWalletContext();
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

        if (!value.tokenLogo) return toast.error('Token logo is required');
        if (!signTransaction) return toast.error('Wallet not connected');

        const reader = new FileReader();
        const base64File = await new Promise<string>((resolve) => {
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(value.tokenLogo!);
        });

        let keyPair: Keypair;
        const rawSuffix = (value.vanitySuffix || '').trim();
        if (rawSuffix) {
          if (!isBase58(rawSuffix)) return toast.error('Suffix must be base58 (no 0, O, I, l).');
          if (rawSuffix.length > 4) return toast.error('Suffix too long.');
          toast.message(`Searching mint ending with “${rawSuffix}”...`);
          const { kp, addr, timedOut } = await findVanityKeypair(rawSuffix, 30);
          keyPair = kp || Keypair.generate();
          if (kp) toast.success(`Found vanity mint: ${addr}`);
          else if (timedOut) toast.message('No match found — using a normal address.');
        } else {
          keyPair = Keypair.generate();
        }

        // Upload metadata JSON to R2
        const metaRes = await fetch('/api/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: value.tokenName,
            symbol: value.tokenSymbol,
