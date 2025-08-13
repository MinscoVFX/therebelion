import { PublicKey, Connection, TransactionInstruction, Transaction } from "@solana/web3.js";
import { createUpdateMetadataAccountV2Instruction, DataV2 } from "@metaplex-foundation/mpl-token-metadata";

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
  const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );

  const metadataPDA = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), new PublicKey(mintAddress).toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  )[0];

  const data: DataV2 = {
    name,
    symbol,
    uri,
    sellerFeeBasisPoints: 0,
    creators: null,
    collection: null,
    uses: null,
  };

  const ix = createUpdateMetadataAccountV2Instruction(
    {
      metadata: metadataPDA,
      updateAuthority: wallet.publicKey,
    },
    {
      updateMetadataAccountArgsV2: {
        data,
        updateAuthority: wallet.publicKey,
        primarySaleHappened: null,
        isMutable: null,
      },
    }
  );

  const tx = new Transaction().add(ix);
  const sig = await wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction(sig, "confirmed");
}
