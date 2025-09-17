import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { parseNetworkFlag, getNetworkConfig } from '../../helpers/cli';
import { airdropSol } from '../../helpers/utils';

config();

async function main() {
  try {
    // Parse network flag
    const network = parseNetworkFlag();
    if (!network) {
      throw new Error('Please provide --network flag (devnet or localnet)');
    }

    const networkConfig = getNetworkConfig(network);
    console.log(`\nUsing network: ${network.toUpperCase()}`);
    console.log(`RPC URL: ${networkConfig.rpcUrl}`);

    const privateKeyString = process.env.PRIVATE_KEY;

    if (!privateKeyString) {
      throw new Error('PRIVATE_KEY is not defined in the .env file');
    }

    const secretKey = bs58.decode(privateKeyString);

    const keypair = Keypair.fromSecretKey(secretKey);

    console.log('Public Key:', keypair.publicKey.toString());

    const keypairArray = Array.from(keypair.secretKey);

    const outputPath = path.join(__dirname, '../../../keypair.json');
    fs.writeFileSync(outputPath, JSON.stringify(keypairArray, null, 4));

    console.log(`Keypair saved to: ${outputPath}`);

    if (networkConfig.shouldAirdrop) {
      console.log(
        `\nAttempting to airdrop ${networkConfig.airdropAmount} SOL on ${network.toUpperCase()}...`
      );
      const connection = new Connection(networkConfig.rpcUrl, 'confirmed');

      try {
        await airdropSol(connection, keypair, networkConfig.airdropAmount);
        console.log(
          `Successfully airdropped ${networkConfig.airdropAmount} SOL on ${network.toUpperCase()}!`
        );
      } catch (airdropError) {
        console.warn(`Airdrop failed: ${airdropError}`);
        if (network === 'localnet') {
          console.log(
            'Make sure you have a local Solana validator running with: npm run start-test-validator'
          );
        } else {
          console.log('This might be due to network congestion or RPC endpoint issues.');
        }
      }
    }

    return keypair;
  } catch (error) {
    console.error('Error generating keypair:', error);
    throw error;
  }
}

main();
