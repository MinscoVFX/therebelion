import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { DBCPartnerClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKeyB58 = process.env.PRIVATE_KEY_B58;

  if (!rpcUrl || !privateKeyB58) {
    throw new Error("Missing RPC_URL or PRIVATE_KEY_B58 env variables.");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = Keypair.fromSecretKey(bs58.decode(privateKeyB58));

  const partnerClient = new DBCPartnerClient(connection, wallet);

  console.log("Fetching all partner pools...");
  const pools = await partnerClient.getPartnerPools(wallet.publicKey);

  for (const pool of pools) {
    console.log(`Claiming fees from pool: ${pool.toBase58()}`);
    try {
      const tx = await partnerClient.claimPartnerFee(new PublicKey(pool));
      console.log(`✅ Claimed from ${pool.toBase58()} — TX: ${tx}`);
    } catch (err) {
      console.error(`❌ Failed to claim from ${pool.toBase58()}:`, err);
    }
  }

  console.log("All claims processed.");
}

main().catch(console.error);
