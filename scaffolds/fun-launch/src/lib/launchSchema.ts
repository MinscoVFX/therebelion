// scaffolds/fun-launch/src/lib/launchSchema.ts
import { z } from 'zod';
import type { LaunchFormValues } from '@/types/launch';

// Simple base58 check (no 0/O/I/l; length 32–44 chars typical for mints)
const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const launchSchema = z.object({
  provider: z.enum(['meteora', 'raydium']),
  name: z.string().min(1, 'Token name is required').max(32, 'Max 32 characters'),
  symbol: z.string().min(1, 'Symbol is required').max(10, 'Max 10 characters'),
  decimals: z
    .number({ invalid_type_error: 'Decimals must be a number' })
    .int('Decimals must be an integer')
    .min(0, 'Min 0')
    .max(9, 'Max 9'),
  imageUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
  description: z.string().max(280, 'Max 280 characters').optional().or(z.literal('')),
  // use strings in the form to avoid precision issues; validate as integers
  supplyTokens: z
    .string()
    .regex(/^\d+$/, 'Enter a whole number (no decimals)')
    .refine((v) => BigInt(v) > 0n, 'Must be > 0'),
  raiseTargetLamports: z
    .string()
    .regex(/^\d+$/, 'Enter a whole number (lamports)')
    .refine((v) => BigInt(v) > 0n, 'Must be > 0'),
  migrateType: z.enum(['amm', 'cpmm']),
  vanityMint: z
    .string()
    .trim()
    .regex(base58Regex, 'Invalid base58 mint address')
    .optional()
    .or(z.literal('')),
}) as unknown as z.ZodType<LaunchFormValues>;

export type LaunchSchema = z.infer<typeof launchSchema>;
