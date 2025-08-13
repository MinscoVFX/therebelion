import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { createUpdateMetadataAccountV2Instruction } from '@metaplex-foundation/mpl-token-metadata';

const METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);

function getMetadataPDA(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { mint, metadataUri, mintAuthority } = req.body || {};

    if (!mint || !metadataUri || !mintAuthority) {
      return res.status(400).json({ error: 'mint, metadataUri, and mintAuthority are required' });
    }

    const connection = new Connection(process.env.NEXT_PUBLIC_RPC_URL!, 'confirmed');
    const mintPk = new PublicKey(mint);
    const metadataPDA = getMetadataPDA(mintPk);

    // Decode the mint authority secret key
    const secretKey = Buffer.from(mintAuthority, 'base64');
    const authorityKeypair = Keypair.fromSecretKey(secretKey);

    const ix = createUpdateMetadataAccountV2Instruction(
      { metadata: metadataPDA, updateAuthority: authorityKeypair.publicKey },
      {
        updateMetadataAccountArgsV2: {
          data: {
            name: mint,
            symbol: '', // Optional: set symbol if needed
            uri: metadataUri,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          updateAuthority: authorityKeypair.publicKey,
          primarySaleHappened: null,
          isMutable: true,
        },
      }
    );

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

    const signedTx = await connection.sendTransaction(tx, [authorityKeypair]);
    await connection.confirmTransaction(signedTx, 'confirmed');

    return res.status(200).json({ success: true, txid: signedTx });
  } catch (error: any) {
    console.error('Error updating on-chain metadata:', error);
    return res.status(500).json({ error: error.message || 'Failed to update metadata' });
  }
}
