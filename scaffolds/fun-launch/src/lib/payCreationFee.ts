// scaffolds/fun-launch/src/lib/payCreationFee.ts
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

export async function payCreationFee(opts: {
  connection: Connection;
  fromPubkey: PublicKey;          // user's wallet
  feeReceiver: string;            // YOUR wallet (base58)
  lamports: number;               // e.g. 0.05 SOL → 0.05 * 1e9
  signAndSend: (tx: Transaction) => Promise<string>; // adapter's signer
}) {
  const { connection, fromPubkey, feeReceiver, lamports, signAndSend } = opts;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: new PublicKey(feeReceiver),
      lamports,
    })
  );
  tx.feePayer = fromPubkey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return await signAndSend(tx); // returns signature
}
