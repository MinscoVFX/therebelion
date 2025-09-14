import { Connection, PublicKey } from '@solana/web3.js';
import { buildRemoveLiquidityIx } from '../lib/damm_v2';

// This is a lightweight type-level smoke test; it won't succeed at runtime without valid accounts.
async function main() {
  const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpc, 'confirmed');
  try {
    // Legacy explicit lpAmount
    await buildRemoveLiquidityIx({
      connection,
      programId: new PublicKey('11111111111111111111111111111111'),
      pool: new PublicKey('11111111111111111111111111111111'),
      lpMint: new PublicKey('11111111111111111111111111111111'),
      user: new PublicKey('11111111111111111111111111111111'),
      userLpAccount: new PublicKey('11111111111111111111111111111111'),
      userAToken: new PublicKey('11111111111111111111111111111111'),
      userBToken: new PublicKey('11111111111111111111111111111111'),
      tokenAMint: new PublicKey('11111111111111111111111111111111'),
      tokenBMint: new PublicKey('11111111111111111111111111111111'),
      tokenAVault: new PublicKey('11111111111111111111111111111111'),
      tokenBVault: new PublicKey('11111111111111111111111111111111'),
      lpAmount: 1n,
    });
    // Percent-based
    await buildRemoveLiquidityIx({
      connection,
      programId: new PublicKey('11111111111111111111111111111111'),
      pool: new PublicKey('11111111111111111111111111111111'),
      lpMint: new PublicKey('11111111111111111111111111111111'),
      user: new PublicKey('11111111111111111111111111111111'),
      userLpAccount: new PublicKey('11111111111111111111111111111111'),
      userAToken: new PublicKey('11111111111111111111111111111111'),
      userBToken: new PublicKey('11111111111111111111111111111111'),
      tokenAMint: new PublicKey('11111111111111111111111111111111'),
      tokenBMint: new PublicKey('11111111111111111111111111111111'),
      tokenAVault: new PublicKey('11111111111111111111111111111111'),
      tokenBVault: new PublicKey('11111111111111111111111111111111'),
      percent: 50,
    });
    // Liquidity delta override
    await buildRemoveLiquidityIx({
      connection,
      programId: new PublicKey('11111111111111111111111111111111'),
      pool: new PublicKey('11111111111111111111111111111111'),
      lpMint: new PublicKey('11111111111111111111111111111111'),
      user: new PublicKey('11111111111111111111111111111111'),
      userLpAccount: new PublicKey('11111111111111111111111111111111'),
      userAToken: new PublicKey('11111111111111111111111111111111'),
      userBToken: new PublicKey('11111111111111111111111111111111'),
      tokenAMint: new PublicKey('11111111111111111111111111111111'),
      tokenBMint: new PublicKey('11111111111111111111111111111111'),
      tokenAVault: new PublicKey('11111111111111111111111111111111'),
      tokenBVault: new PublicKey('11111111111111111111111111111111'),
      liquidityDelta: 123n,
    });
  } catch (e) {
    // Expected to fail because of invalid accounts; we only care that it type-checks and flows.
    console.log('[smoke remove liquidity] expected failure:', (e as any)?.message);
  }
}

main();
