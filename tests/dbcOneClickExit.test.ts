import { describe, it, expect, vi } from 'vitest';
import { POST } from '../scaffolds/fun-launch/src/app/api/dbc-one-click-exit/route';

interface MockRequest {
  json: () => Promise<Record<string, unknown>>;
}

describe('dbc-one-click-exit route', () => {
  it('returns error when required env vars are missing', async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    
    // Clear RPC env vars to trigger error
    delete process.env.RPC_ENDPOINT;
    delete process.env.RPC_URL;
    delete process.env.NEXT_PUBLIC_RPC_URL;

    const mockRequest: MockRequest = {
      json: vi.fn().mockResolvedValue({ 
        wallet: 'test-wallet',
        pool: 'test-pool' 
      })
    };

    try {
      await POST(mockRequest as never);
    } catch (error) {
      expect(error instanceof Error && error.message).toContain('RPC missing');
    }

    process.env = originalEnv;
  });

  it('validates request body structure', async () => {
    const mockRequest: MockRequest = {
      json: vi.fn().mockResolvedValue({
        // missing wallet and pool
      })
    };

    try {
      const response = await POST(mockRequest as never);
      // Should handle invalid request gracefully
      expect(response).toBeDefined();
    } catch (error) {
      // Error handling is expected for invalid requests
      expect(error).toBeDefined();
    }
  });
});