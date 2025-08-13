import { NextApiRequest, NextApiResponse } from 'next';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
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
  try {
    const { mint, metadataUri, name, symbol, mintAuthority } = req.body;

    if (!mint || !metadataUri || !name || !symbol || !mintAuthority) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Connect to Solana
    const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

    // Recreate mint authority Keypair from base64
    const secretKey = Buffer.from(mintAuthority, 'base64');
    const keypair = Keypair.fromSecretKey(secretKey);

    // Find metadata account PDA
    const metadataPDA = getMetadataPDA(new PublicKey(mint));

    // Build update instruction
    const ix = createUpdateMetadataAccountV2Instruction(
      { metadata: metadataPDA, updateAuthority: keypair.publicKey },
      {
        updateMetadataAccountArgsV2: {
          data: {
            name,
            symbol,
            uri: metadataUri,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
          },
          updateAuthority: keypair.publicKey,
          primarySaleHappened: null,
          isMutable: true,
        },
      }
    );

    // Send transaction
    const tx = new Transaction().add(ix);
    const sig = await connection.sendTransaction(tx, [keypair]);
    await connection.confirmTransaction(sig, 'confirmed');

    return res.status(200).json({ success: true, signature: sig });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
