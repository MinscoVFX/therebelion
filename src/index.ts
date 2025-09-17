import { Connection } from '@solana/web3.js';
import { connectionService } from '@/services/connection';
import { MeteoraService } from '@/services/meteora';
import { TOKENS, PROGRAM_IDS } from '@/config/constants';

// Export all services and types
export { MeteoraService } from '@/services/meteora';
export { connectionService } from '@/services/connection';
export * from '@/types/index';
export * from '@/config/constants';
export * from '@/utils/index';

// Initialize services
export async function initializeLaunchpad() {
  try {
    const connection = connectionService.getConnection();
    const meteoraService = new MeteoraService(connection);

    // Test connection
    const isHealthy = await connectionService.getHealth();
    if (!isHealthy) {
      throw new Error('Unable to connect to Solana network');
    }

    console.log('Launchpad initialized successfully');

    return {
      connection,
      meteoraService,
      tokens: TOKENS,
      programIds: PROGRAM_IDS,
    };
  } catch (error) {
    console.error('Failed to initialize launchpad:', error);
    throw error;
  }
}

// Define proper interface for SDK export
interface LaunchpadSDK {
  initializeLaunchpad: typeof initializeLaunchpad;
  connectionService: {
    getConnection(): Connection;
    getHealth(): Promise<boolean>;
    getBlockHeight(): Promise<number>;
    setCommitment(commitment: string): void;
  };
  MeteoraService: typeof MeteoraService;
  TOKENS: typeof TOKENS;
  PROGRAM_IDS: typeof PROGRAM_IDS;
}

// Default export with proper typing
export const launchpadSDK: LaunchpadSDK = {
  initializeLaunchpad,
  connectionService: {
    getConnection: () => connectionService.getConnection(),
    getHealth: () => connectionService.getHealth(),
    getBlockHeight: () => connectionService.getBlockHeight(),
    setCommitment: (commitment: string) => connectionService.setCommitment(commitment),
  },
  MeteoraService,
  TOKENS,
  PROGRAM_IDS,
};

export default launchpadSDK;
