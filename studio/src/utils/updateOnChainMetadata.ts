import { createUpdateMetadataAccountV2Instruction } from "@metaplex-foundation/mpl-token-metadata";
import { PublicKey, Transaction, Connection, SendOptions } from "@solana/web3.js";

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function getMetadataPDA(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  )[0];
}

interface UpdateParams {
  connection: Connection;
  wallet: { publicKey: PublicKey; signTransaction: any };
  mintAddress: string;
  name: string;
  symbol: string;
  uri: string;
}

export async function updateOnChainMetadata({
  connection,
  wallet,
  mintAddress,
  name,
  symbol,
  uri,
}: UpdateParams) {
  const mint = new PublicKey(mintAddress);
  const metadataPDA = getMetadataPDA(mint);

  const ix = createUpdateMetadataAccountV2Instruction(
    { metadata: metadataPDA, updateAuthority: wallet.publicKey },
    {
      updateMetadataAccountArgsV2: {
        data: {
          name,
          symbol,
          uri, // points to your R2 JSON file
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
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
  } as SendOptions);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
