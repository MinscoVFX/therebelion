import { Keypair, Connection } from '@solana/web3.js';
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

    // Load keypair from file
    const keypairPath = path.join(__dirname, '../../../keypair.json');

    if (!fs.existsSync(keypairPath)) {
      throw new Error(
        `Keypair file not found at ${keypairPath}. Please run generate-keypair first.`
      );
    }

    const keypairData = fs.readFileSync(keypairPath, 'utf8');
    const secretKeyArray = JSON.parse(keypairData);
    const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));

    console.log('Public Key:', keypair.publicKey.toString());

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
    } else {
      console.log(`🚫 Airdrop not enabled for ${network.toUpperCase()}`);
    }

    return keypair;
  } catch (error) {
    console.error('Error airdropping SOL:', error);
    throw error;
  }
}

main();
