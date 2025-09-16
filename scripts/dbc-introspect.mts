#!/usr/bin/env ts-node
/**
 * Extract DBC instruction discriminators & account metas from on-chain transactions.
 * Usage:
 *   pnpm ts-node scripts/dbc-introspect.mts --program <PROGRAM_ID> --sigs sig1,sig2 --rpc https://... --out output.json
 * If --sigs omitted, reads from scripts/dbc_sigs.txt (one signature per line).
 */
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

interface Args {
  [k: string]: string | undefined;
}
interface ExtractedInstruction {
  signature: string;
  ixIndex?: number;
  discriminator?: string;
  accounts?: string[];
  error?: string;
}
interface IntrospectOutput {
  programId: string;
  rpc: string;
  signatures: string[];
  instructions: ExtractedInstruction[];
  summary?: { discriminator: string; occurrences: number; samples: string[] }[];
}
function parseArgs(): Args {
  const args: Args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = process.argv[i + 1]?.startsWith('--') ? '' : process.argv[i + 1];
      if (val && !val.startsWith('--')) {
        args[key] = val;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}
const args = parseArgs();
const programIdStr = args.program || process.env.DBC_PROGRAM_ID;
if (!programIdStr) {
  console.error('Missing --program or DBC_PROGRAM_ID env');
  process.exit(1);
}
const programId = new PublicKey(programIdStr);
const rpc =
  args.rpc ||
  process.env.RPC_ENDPOINT ||
  process.env.RPC_URL ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://api.mainnet-beta.solana.com';
const sigsArg = args.sigs;
let sigs: string[] = [];
if (sigsArg)
  sigs = sigsArg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
else {
  const fallback = path.resolve(process.cwd(), 'scripts/dbc_sigs.txt');
  if (fs.existsSync(fallback)) {
    sigs = fs
      .readFileSync(fallback, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
}
if (sigs.length === 0) {
  console.error('No signatures provided (use --sigs or scripts/dbc_sigs.txt)');
  process.exit(1);
}

async function main() {
  const connection = new Connection(rpc, 'confirmed');
  const out: IntrospectOutput = {
    programId: programId.toBase58(),
    rpc,
    signatures: sigs,
    instructions: [],
  };
  const discriminatorMap: Record<string, string[]> = {};
  for (const sig of sigs) {
    try {
      const tx = await connection.getTransaction(sig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) {
        out.instructions.push({ signature: sig, error: 'notFound' });
        continue;
      }
      const message = tx.transaction.message; // v0 or legacy handled by web3.js
      message.compiledInstructions.forEach((ix, idx) => {
        const pid = message.staticAccountKeys[ix.programIdIndex];
        if (pid.equals(programId)) {
          // web3.js v1.91+: compiled ix data is already a Uint8Array; ensure Node Buffer
          const data = Buffer.isBuffer(ix.data) ? ix.data : Buffer.from(ix.data as Uint8Array);
          const disc = data.subarray(0, 8).toString('hex');
          const accounts = ix.accountKeyIndexes.map((i) => message.staticAccountKeys[i].toBase58());
          out.instructions.push({ signature: sig, ixIndex: idx, discriminator: disc, accounts });
          discriminatorMap[disc] = discriminatorMap[disc] || [];
          discriminatorMap[disc].push(sig + ':' + idx);
        }
      });
    } catch (e) {
      out.instructions.push({ signature: sig, error: (e as Error).message });
    }
  }
  out.summary = Object.entries(discriminatorMap).map(([disc, list]) => ({
    discriminator: disc,
    occurrences: list.length,
    samples: list.slice(0, 5),
  }));
  const json = JSON.stringify(out, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json);
    console.log('Wrote ' + args.out);
  } else {
    console.log(json);
  }
}
main();
