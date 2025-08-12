import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getPartnerPools, claimTradingFee } from "@meteora-ag/dynamic-bonding-curve-sdk";

const RPC_URL = process.env.RPC_URL!;
const PRIVATE_KEY_B58 = process.env.PRIVATE_KEY_B58!;
const CONFIG_KEY = new PublicKey(process.env.CONFIG_KEY!);

(async () => {
  const connection = new Connection(RPC_URL);
  const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY_B58));

  console.log("Fetching all pools for partner:", CONFIG_KEY.toBase58());
  const pools = await getPartnerPools(connection, CONFIG_KEY);

  console.log(`Found ${pools.length} pools. Claiming fees...`);
  for (const pool of pools) {
    console.log(`Claiming fees from pool: ${pool.toBase58()}`);
    try {
      const txid = await claimTradingFee(connection, wallet, pool);
      console.log(`✅ Claimed fees from ${pool.toBase58()} — TX: ${txid}`);
    } catch (e) {
      console.error(`❌ Failed to claim from ${pool.toBase58()}`, e);
    }
  }
})();
