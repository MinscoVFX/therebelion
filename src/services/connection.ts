import { Connection, Commitment } from '@solana/web3.js';
import { RPC_ENDPOINTS, NETWORK } from '@/config/constants.js';

class ConnectionService {
  private connection: Connection;
  private commitment: Commitment = 'confirmed';

  constructor() {
    const rpcUrl = RPC_ENDPOINTS[NETWORK];
    this.connection = new Connection(rpcUrl, {
      commitment: this.commitment,
      confirmTransactionInitialTimeout: 60000,
    });
  }

  getConnection(): Connection {
    return this.connection;
  }

  async getHealth(): Promise<boolean> {
    try {
      await this.connection.getSlot();
      return true;
    } catch (error) {
      console.error('Connection health check failed:', error);
      return false;
    }
  }

  async getBlockHeight(): Promise<number> {
    return await this.connection.getBlockHeight();
  }

  setCommitment(commitment: Commitment): void {
    this.commitment = commitment;
    this.connection = new Connection(this.connection.rpcEndpoint, {
      commitment: this.commitment,
      confirmTransactionInitialTimeout: 60000,
    });
  }
}

export const connectionService = new ConnectionService();
export default connectionService;
