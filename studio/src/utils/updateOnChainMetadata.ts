// scaffolds/fun-launch/src/utils/updateOnChainMetadata.ts
import { createUpdateMetadataAccountV2Instruction } from "@metaplex-foundation/mpl-token-metadata";
import { PublicKey, Transaction, Connection, SendTransactionError } from "@solana/web3.js";

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function getMetadataPDA(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}

export async function updateOnChainMetadata({
  connection,
  wallet,
  mintAddress,
  name,
  symbol,
  uri,
}: {
  connection: Connection;
  wallet: { publicKey: PublicKey; sendTransaction: any };
  mintAddress: string;
  name: string;
  symbol: string;
  uri: string;
}) {
  const mint = new PublicKey(mintAddress);
  const metadataPDA = getMetadataPDA(mint);

  const ix = createUpdateMetadataAccountV2Instruction(
    { metadata: metadataPDA, updateAuthority: wallet.publicKey },
    {
      updateMetadataAccountArgsV2: {
        data: {
          name,
          symbol,
          uri,
          sellerFeeBasisPoints: 0,
          creators: null,
          collection: null,
          uses: null,
        },
        updateAuthority: wallet.publicKey,
        primarySaleHappened: null,
        isMutable: true,
      },
    }
  );

  const tx = new Transaction().add(ix);
  try {
    const sig = await wallet.sendTransaction(tx, connection);
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  } catch (err) {
    console.error("Failed to update on-chain metadata", err);
    throw err;
  }
}
