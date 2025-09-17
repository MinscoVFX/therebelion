import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveClaimDiscriminatorStrict } from '../../lib/dbc';

interface DbcExitRequest {
  action: 'claim' | 'withdraw';
  poolAddress?: string;
  amount?: string;
}

interface DbcExitResponse {
  success: boolean;
  transactionSignature?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DbcExitResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { action, poolAddress, amount }: DbcExitRequest = req.body;

    // Validate request
    if (!action) {
      return res.status(400).json({ success: false, error: 'Action is required' });
    }

    // Return 501 for withdraw requests
    if (action === 'withdraw') {
      return res.status(501).json({ 
        success: false, 
        error: 'Withdraw is disabled until official layout integration.' 
      });
    }

    // Handle claim action
    if (action === 'claim') {
      if (!poolAddress) {
        return res.status(400).json({ success: false, error: 'Pool address is required for claim' });
      }

      // Resolve discriminator strictly
      const discriminator = resolveClaimDiscriminatorStrict();
      
      // TODO: Implement actual DBC claim logic here
      // For now, return a placeholder response
      console.log('Claim discriminator resolved:', discriminator.toString('hex'));
      
      return res.status(200).json({
        success: true,
        transactionSignature: 'placeholder_tx_signature'
      });
    }

    return res.status(400).json({ success: false, error: 'Invalid action' });
  } catch (error) {
    console.error('DBC exit API error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}