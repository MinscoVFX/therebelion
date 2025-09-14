/**
 * Resolves a DAMM V2 pool address from LP mint.
 * Returns the pool address if found, otherwise throws.
 * Matches Meteora doc export pattern for launchpad integration.
 */
export async function resolvePoolByLpMint({ connection, lpMint }: {
  connection: Connection;
  lpMint: PublicKey;
}): Promise<PublicKey> {
  const cp = new CpAmm(connection);
  const pools = await cp.getAllPools();
  const found = pools.find((p: any) => p.lpMint.toBase58() === lpMint.toBase58());
  if (!found) throw new Error('No DAMM V2 pool found for given LP mint');
  return found.publicKey;
}
export default resolvePool;
/**
 * Resolves a DAMM V2 pool address from token mints and config.
 * Returns the pool address if found, otherwise throws.
 */
/**
 * Resolves a DAMM V2 pool address from token mints.
 * Returns the pool address if found, otherwise throws.
 * Matches Meteora doc export pattern.
 */
export async function resolvePool({ connection, tokenAMint, tokenBMint }: {
  connection: Connection;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
}): Promise<PublicKey> {
  const cp = new CpAmm(connection);
  const pools = await cp.getAllPools();
  const found = pools.find(
    (p: any) =>
      p.tokenAMint.toBase58() === tokenAMint.toBase58() &&
      p.tokenBMint.toBase58() === tokenBMint.toBase58()
  );
  if (!found) throw new Error('No DAMM V2 pool found for given mints');
  return found.publicKey;
}
import { TransactionInstruction, Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { CpAmm, type RemoveLiquidityParams } from '@meteora-ag/cp-amm-sdk';
// TOKEN_PROGRAM_ID imported later with other SPL symbols (avoid duplicate)

/**
 * Realistic remove-liquidity instruction builder leveraging cp-amm-sdk.
 * Returns an array so callers can spread into their tx assembly.
 * Falls back gracefully if position discovery fails.
 */
export async function buildRemoveLiquidityIx({
  connection,
  programId: _programId, // reserved for potential future use
  pool,
  lpMint: _lpMint,
  user,
  userLpAccount: _userLpAccount,
  userAToken: _userAToken,
  userBToken: _userBToken,
  tokenAMint,
  tokenBMint,
  tokenAVault,
  tokenBVault,
  lpAmount,
  // New optional overrides:
  positionPubkey, // explicitly specify a position (skip discovery)
  percent, // percentage (0-100] of the position liquidity to remove (ignored if lpAmount provided)
  liquidityDelta, // raw liquidity delta override (BigInt) takes precedence over percent if provided
  slippageBps = 50, // 0.50% default
}: {
  connection: Connection;
  programId: PublicKey;
  pool: PublicKey;
  lpMint: PublicKey;
  user: PublicKey;
  userLpAccount: PublicKey;
  userAToken: PublicKey;
  userBToken: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  lpAmount?: bigint; // kept for backward compatibility (full amount or partial explicit amount)
  positionPubkey?: PublicKey;
  percent?: number; // 0 < percent <= 100
  liquidityDelta?: bigint; // direct override of liquidity delta (advanced)
  slippageBps?: number;
}): Promise<TransactionInstruction[]> {
  const cp = new CpAmm(connection);

  // 1. Resolve position(s)
  let discoveredPositions: any[] = [];
  let chosenPosition: any | null = null;
  let resolvedPositionPubkey: PublicKey | undefined = positionPubkey;

  // Discover only if user did not explicitly pass a position
  if (!resolvedPositionPubkey) {
    try {
      const helper = (cp as any).getAllPositionNftAccountByOwner || (cp as any).getAllUserPositionNftAccount;
      if (helper) {
        const fetched = await helper({ owner: user });
        if (Array.isArray(fetched)) discoveredPositions = fetched;
      }
    } catch {
      // ignore discovery errors
    }
    const poolPositions = discoveredPositions.filter((p: any) => p.account?.pool?.toBase58?.() === pool.toBase58());
    if (!poolPositions.length) throw new Error('No position NFT found for pool when removing liquidity.');
    poolPositions.sort((a: any, b: any) => {
      const la = a.account?.liquidity ?? new BN(0);
      const lb = b.account?.liquidity ?? new BN(0);
      if (la.lt(lb)) return 1;
      if (la.gt(lb)) return -1;
      return 0;
    });
    chosenPosition = poolPositions[0];
    resolvedPositionPubkey = chosenPosition.publicKey ?? chosenPosition.account?.publicKey;
  } else {
    // If positionPubkey provided, try to fetch its account (best-effort) for liquidity & quoting.
    try {
      const fetchOne = (cp as any).getPositionAccount || (cp as any).getUserPositionAccount;
      if (fetchOne) {
        const acct = await fetchOne({ position: resolvedPositionPubkey });
        if (acct) chosenPosition = { publicKey: resolvedPositionPubkey, account: acct };
      }
    } catch {
      // ignore failed single fetch; we'll proceed with limited info.
    }
  }
  if (!resolvedPositionPubkey) throw new Error('Unable to resolve position public key for remove liquidity.');

  const positionLiquidity: BN | null = chosenPosition?.account?.liquidity
    ? new BN(chosenPosition.account.liquidity.toString())
    : null;

  // 2. Compute withdraw quote to derive min token amounts with slippage cushion.
  // Fallback if sdk shape differs.
  let tokenAAmountThreshold = new BN(0);
  let tokenBAmountThreshold = new BN(0);
  try {
    const quoteFn: any = (cp as any).getWithdrawQuote;
    if (quoteFn) {
      const quote = await quoteFn({
        pool,
        position: resolvedPositionPubkey,
        liquidityDelta: positionLiquidity ?? new BN(0),
        slippageBps,
        owner: user,
      });
      if (quote?.tokenAOut) tokenAAmountThreshold = new BN(quote.tokenAOut.toString());
      if (quote?.tokenBOut) tokenBAmountThreshold = new BN(quote.tokenBOut.toString());
    }
  } catch { /* ignore */ }

  // 3. Determine token program IDs (handle 2022).
  const tokenAProgram = TOKEN_PROGRAM_ID;
  const tokenBProgram = TOKEN_PROGRAM_ID;

  // 4. Build remove liquidity TxBuilder from SDK. If lpAmount covers all, we could call removeAllLiquidity.
  // Determine desired liquidity delta
  let finalLiquidityDeltaBn: BN | null = null;
  if (typeof liquidityDelta === 'bigint') {
    finalLiquidityDeltaBn = new BN(liquidityDelta.toString());
  } else if (typeof lpAmount === 'bigint') {
    finalLiquidityDeltaBn = new BN(lpAmount.toString());
  } else if (typeof percent === 'number' && percent > 0 && percent <= 100) {
    if (!positionLiquidity) throw new Error('Percent-based removal requested but position liquidity unknown.');
    // Convert percent to basis points (two decimals) to avoid float precision issues.
    const bps = Math.round(percent * 100); // e.g. 25.37% -> 2537 bps
    finalLiquidityDeltaBn = positionLiquidity.mul(new BN(bps)).div(new BN(100 * 100));
  } else if (positionLiquidity) {
    // default remove-all
    finalLiquidityDeltaBn = positionLiquidity;
  } else {
    throw new Error('Must provide lpAmount, liquidityDelta, percent, or discoverable position liquidity.');
  }

  const removingAll = positionLiquidity ? positionLiquidity.eq(finalLiquidityDeltaBn) : false;

  let txBuilder: any;
  try {
    if (removingAll && (cp as any).removeAllLiquidity) {
      txBuilder = (cp as any).removeAllLiquidity({
        owner: user,
        position: resolvedPositionPubkey,
        pool,
        positionNftAccount: chosenPosition?.account?.positionNftAccount ?? resolvedPositionPubkey,
        tokenAMint,
        tokenBMint,
        tokenAVault,
        tokenBVault,
        tokenAProgram,
        tokenBProgram,
        vestings: [],
        currentPoint: new BN(0),
        tokenAAmountThreshold,
        tokenBAmountThreshold,
      });
    } else {
  const liquidityDelta = finalLiquidityDeltaBn;
      txBuilder = (cp as any).removeLiquidity({
        owner: user,
        position: resolvedPositionPubkey,
        pool,
        positionNftAccount: chosenPosition?.account?.positionNftAccount ?? resolvedPositionPubkey,
        liquidityDelta,
        tokenAAmountThreshold,
        tokenBAmountThreshold,
        tokenAMint,
        tokenBMint,
        tokenAVault,
        tokenBVault,
        tokenAProgram,
        tokenBProgram,
        vestings: [],
        currentPoint: new BN(0),
      } as RemoveLiquidityParams);
    }
  } catch (e) {
    throw new Error('SDK removeLiquidity build failed: ' + (e as any)?.message);
  }

  // 5. Extract instructions (builder may expose .tx or .build())
  const ixs: TransactionInstruction[] = [];
  if (!txBuilder) throw new Error('TxBuilder undefined after removeLiquidity call.');
  try {
    if (Array.isArray((txBuilder as any).ixs)) {
      ixs.push(...(txBuilder as any).ixs);
    } else if ((txBuilder as any).build) {
      const built = await (txBuilder as any).build();
      if (Array.isArray(built)) ixs.push(...built);
      else if (built?.instructions) ixs.push(...built.instructions);
    } else if ((txBuilder as any).tx) {
      const tx = (txBuilder as any).tx;
      // if it's a @solana/web3.js Transaction, extract its instructions array
      if (tx?.instructions) ixs.push(...tx.instructions);
    }
  } catch (e) {
    throw new Error('Failed extracting removeLiquidity instructions: ' + (e as any)?.message);
  }

  if (!ixs.length) throw new Error('No instructions produced by removeLiquidity builder.');
  return ixs;
}
import { Wallet } from '@coral-xyz/anchor';
import {
  BaseFee,
  BIN_STEP_BPS_DEFAULT,
  BIN_STEP_BPS_U128_DEFAULT,
  calculateTransferFeeIncludedAmount,
  // CpAmm already imported above for remove liquidity builder
  getBaseFeeParams,
  getDynamicFeeParams,
  getLiquidityDeltaFromAmountA,
  getPriceFromSqrtPrice,
  getSqrtPriceFromPrice,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PoolFeesParams,
} from '@meteora-ag/cp-amm-sdk';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from '@solana/spl-token';
import { Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { DammV2Config } from '../../utils/types';
import {
  getAmountInLamports,
  getDecimalizedAmount,
  getQuoteDecimals,
  modifyComputeUnitPriceIx,
  runSimulateTransaction,
} from '../../helpers';
import { DEFAULT_SEND_TX_MAX_RETRIES } from '../../utils/constants';

/**
 * Create a one-sided DAMM V2 pool
 * @param config - The DAMM V2 config
 * @param connection - The connection to the network
 * @param wallet - The wallet to use for the transaction
 * @param baseTokenMint - The base token mint
 * @param quoteTokenMint - The quote token mint
 */
export async function createDammV2OneSidedPool(
  config: DammV2Config,
  connection: Connection,
  wallet: Wallet,
  baseTokenMint: PublicKey,
  quoteTokenMint: PublicKey
) {
  if (!config.dammV2Config) {
    throw new Error('Missing DAMM V2 configuration');
  }
  console.log('\n> Initializing one-sided DAMM V2 pool...');

  if (!config.quoteMint) {
    throw new Error('Quote mint is required');
  }

  const quoteDecimals = await getQuoteDecimals(connection, config.quoteMint);

  let baseTokenInfo = null;
  let baseTokenProgram = TOKEN_PROGRAM_ID;

  const baseMintAccountInfo = await connection.getAccountInfo(
    new PublicKey(baseTokenMint),
    connection.commitment
  );

  if (!baseMintAccountInfo) {
    throw new Error(`Base mint account not found: ${baseTokenMint}`);
  }

  const baseMint = unpackMint(baseTokenMint, baseMintAccountInfo, baseMintAccountInfo.owner);

  if (baseMintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const epochInfo = await connection.getEpochInfo();
    baseTokenInfo = {
      mint: baseMint,
      currentEpoch: epochInfo.epoch,
    };
    baseTokenProgram = TOKEN_2022_PROGRAM_ID;
  }

  const baseDecimals = baseMint.decimals;

  const cpAmmInstance = new CpAmm(connection);

  const {
    initPrice,
    maxPrice,
    poolFees,
    baseAmount,
    quoteAmount,
    hasAlphaVault,
    activationPoint,
    activationType,
    collectFeeMode,
  } = config.dammV2Config;

  const {
    maxBaseFeeBps,
    minBaseFeeBps,
    feeSchedulerMode,
    totalDuration,
    numberOfPeriod,
    useDynamicFee,
  } = poolFees;

  let tokenAAmount = getAmountInLamports(baseAmount, baseDecimals);
  let tokenBAmount = new BN(0);

  // transfer fee if token2022
  if (baseTokenInfo) {
    tokenAAmount = tokenAAmount.sub(
      calculateTransferFeeIncludedAmount(
        tokenAAmount,
        baseTokenInfo.mint,
        baseTokenInfo.currentEpoch
      ).transferFee
    );
  }

  const maxSqrtPrice = maxPrice
    ? getSqrtPriceFromPrice(maxPrice.toString(), baseDecimals, quoteDecimals)
    : MAX_SQRT_PRICE;

  const initSqrtPrice = getSqrtPriceFromPrice(initPrice.toString(), baseDecimals, quoteDecimals);
  let minSqrtPrice = initSqrtPrice;

  const liquidityDelta = getLiquidityDeltaFromAmountA(tokenAAmount, initSqrtPrice, maxSqrtPrice);

  if (quoteAmount) {
    tokenBAmount = getAmountInLamports(quoteAmount, quoteDecimals);
    // L = Δb / (√P_upper - √P_lower)
    // √P_lower = √P_upper - Δb / L
    const numerator = tokenBAmount.shln(128).div(liquidityDelta);
    minSqrtPrice = initSqrtPrice.sub(numerator);
  }
  console.log(
    `- Using base token with amount = ${getDecimalizedAmount(tokenAAmount, baseDecimals)}`
  );

  console.log(`- Init price ${getPriceFromSqrtPrice(initSqrtPrice, baseDecimals, quoteDecimals)}`);

  console.log(
    `- Price range [${getPriceFromSqrtPrice(minSqrtPrice, baseDecimals, quoteDecimals)}, ${getPriceFromSqrtPrice(maxSqrtPrice, baseDecimals, quoteDecimals)}]`
  );

  let dynamicFee = null;
  if (useDynamicFee) {
    const dynamicFeeConfig = config.dammV2Config.poolFees.dynamicFeeConfig;
    if (dynamicFeeConfig) {
      dynamicFee = {
        binStep: BIN_STEP_BPS_DEFAULT,
        binStepU128: BIN_STEP_BPS_U128_DEFAULT,
        filterPeriod: dynamicFeeConfig.filterPeriod,
        decayPeriod: dynamicFeeConfig.decayPeriod,
        reductionFactor: dynamicFeeConfig.reductionFactor,
        variableFeeControl: dynamicFeeConfig.variableFeeControl,
        maxVolatilityAccumulator: dynamicFeeConfig.maxVolatilityAccumulator,
      };
    } else {
      dynamicFee = getDynamicFeeParams(config.dammV2Config.poolFees.minBaseFeeBps);
    }
  }

  const baseFee: BaseFee = getBaseFeeParams(
    maxBaseFeeBps,
    minBaseFeeBps,
    feeSchedulerMode,
    numberOfPeriod,
    totalDuration
  );

  const poolFeesParams: PoolFeesParams = {
    baseFee,
    padding: [],
    dynamicFee,
  };
  const positionNft = Keypair.generate();

  const {
    tx: initCustomizePoolTx,
    pool,
    position,
  } = await cpAmmInstance.createCustomPool({
    payer: wallet.publicKey,
    creator: new PublicKey(config.dammV2Config.creator),
    positionNft: positionNft.publicKey,
    tokenAMint: baseTokenMint,
    tokenBMint: quoteTokenMint,
    tokenAAmount: tokenAAmount,
    tokenBAmount: tokenBAmount,
    sqrtMinPrice: minSqrtPrice,
    sqrtMaxPrice: maxSqrtPrice,
    liquidityDelta: liquidityDelta,
    initSqrtPrice,
    poolFees: poolFeesParams,
    hasAlphaVault: hasAlphaVault,
    activationType,
    collectFeeMode: collectFeeMode,
    activationPoint: activationPoint ? new BN(activationPoint) : null,
    tokenAProgram: baseTokenProgram,
    tokenBProgram: TOKEN_PROGRAM_ID,
  });

  modifyComputeUnitPriceIx(initCustomizePoolTx, config.computeUnitPriceMicroLamports);

  console.log(`\n> Pool address: ${pool}`);
  console.log(`\n> Position address: ${position}`);

  if (config.dryRun) {
    console.log(`> Simulating init pool tx...`);
    await runSimulateTransaction(connection, [wallet.payer, positionNft], wallet.publicKey, [
      initCustomizePoolTx,
    ]);
  } else {
    console.log(`>> Sending init pool transaction...`);
    const initPoolTxHash = await sendAndConfirmTransaction(
      connection,
      initCustomizePoolTx,
      [wallet.payer, positionNft],
      {
        commitment: connection.commitment,
        maxRetries: DEFAULT_SEND_TX_MAX_RETRIES,
      }
    ).catch((err) => {
      console.error(err);
      throw err;
    });
    console.log(`>>> Pool initialized successfully with tx hash: ${initPoolTxHash}`);
  }
}

/**
 * Create a balanced DAMM V2 pool
 * @param config - The DAMM V2 config
 * @param connection - The connection to the network
 * @param wallet - The wallet to use for the transaction
 * @param baseTokenMint - The base token mint
 * @param quoteTokenMint - The quote token mint
 */
export async function createDammV2BalancedPool(
  config: DammV2Config,
  connection: Connection,
  wallet: Wallet,
  baseTokenMint: PublicKey,
  quoteTokenMint: PublicKey
) {
  if (!config.dammV2Config) {
    throw new Error('Missing DAMM V2 configuration');
  }
  console.log('\n> Initializing balanced DAMM V2 pool...');

  if (!config.quoteMint) {
    throw new Error('Quote mint is required');
  }

  const quoteDecimals = await getQuoteDecimals(connection, config.quoteMint);

  let baseTokenInfo = null;
  let baseTokenProgram = TOKEN_PROGRAM_ID;

  const baseMintAccountInfo = await connection.getAccountInfo(
    new PublicKey(baseTokenMint),
    connection.commitment
  );

  if (!baseMintAccountInfo) {
    throw new Error(`Base mint account not found: ${baseTokenMint}`);
  }

  const baseMint = unpackMint(baseTokenMint, baseMintAccountInfo, baseMintAccountInfo.owner);

  if (baseMintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const epochInfo = await connection.getEpochInfo();
    baseTokenInfo = {
      mint: baseMint,
      currentEpoch: epochInfo.epoch,
    };
    baseTokenProgram = TOKEN_2022_PROGRAM_ID;
  }

  let quoteTokenInfo = null;
  let _quoteTokenProgram = TOKEN_PROGRAM_ID;

  const quoteMintAccountInfo = await connection.getAccountInfo(
    new PublicKey(quoteTokenMint),
    connection.commitment
  );

  if (!quoteMintAccountInfo) {
    throw new Error(`Quote mint account not found: ${quoteTokenMint}`);
  }

  const quoteMint = unpackMint(quoteTokenMint, quoteMintAccountInfo, quoteMintAccountInfo.owner);

  if (quoteMintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const epochInfo = await connection.getEpochInfo();
    quoteTokenInfo = {
      mint: quoteMint,
      currentEpoch: epochInfo.epoch,
    };
    _quoteTokenProgram = TOKEN_2022_PROGRAM_ID;
  }

  const baseDecimals = baseMint.decimals;

  // create cp amm instance
  const cpAmmInstance = new CpAmm(connection);
  const {
    baseAmount,
    quoteAmount,
    initPrice,
    poolFees,
    hasAlphaVault,
    activationPoint,
    activationType,
    collectFeeMode,
  } = config.dammV2Config;

  const {
    maxBaseFeeBps,
    minBaseFeeBps,
    numberOfPeriod,
    totalDuration,
    feeSchedulerMode,
    useDynamicFee,
  } = poolFees;

  if (!quoteAmount) {
    throw new Error('Quote amount is required for balanced pool');
  }

  let tokenAAmount = getAmountInLamports(baseAmount, baseDecimals);
  let tokenBAmount = getAmountInLamports(quoteAmount, quoteDecimals);

  if (baseTokenInfo) {
    tokenAAmount = tokenAAmount.sub(
      calculateTransferFeeIncludedAmount(
        tokenAAmount,
        baseTokenInfo.mint,
        baseTokenInfo.currentEpoch
      ).transferFee
    );
  }

  if (quoteTokenInfo) {
    tokenBAmount = tokenBAmount.sub(
      calculateTransferFeeIncludedAmount(
        tokenBAmount,
        quoteTokenInfo.mint,
        quoteTokenInfo.currentEpoch
      ).transferFee
    );
  }

  const initSqrtPrice = getSqrtPriceFromPrice(initPrice.toString(), baseDecimals, quoteDecimals);

  const minSqrtPrice = MIN_SQRT_PRICE;
  const maxSqrtPrice = MAX_SQRT_PRICE;

  const liquidityDelta = cpAmmInstance.getLiquidityDelta({
    maxAmountTokenA: tokenAAmount,
    maxAmountTokenB: tokenBAmount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice: minSqrtPrice,
    sqrtMaxPrice: maxSqrtPrice,
    tokenAInfo: baseTokenInfo || undefined,
  });

  console.log(
    `- Using base token with amount = ${getDecimalizedAmount(tokenAAmount, baseDecimals)}`
  );
  console.log(
    `- Using quote token with amount = ${getDecimalizedAmount(tokenBAmount, quoteDecimals)}`
  );

  console.log(`- Init price ${getPriceFromSqrtPrice(initSqrtPrice, baseDecimals, quoteDecimals)}`);

  console.log(
    `- Price range [${getPriceFromSqrtPrice(minSqrtPrice, baseDecimals, quoteDecimals)}, ${getPriceFromSqrtPrice(maxSqrtPrice, baseDecimals, quoteDecimals)}]`
  );

  let dynamicFee = null;
  if (useDynamicFee) {
    const dynamicFeeConfig = config.dammV2Config.poolFees.dynamicFeeConfig;
    if (dynamicFeeConfig) {
      dynamicFee = {
        binStep: BIN_STEP_BPS_DEFAULT,
        binStepU128: BIN_STEP_BPS_U128_DEFAULT,
        filterPeriod: dynamicFeeConfig.filterPeriod,
        decayPeriod: dynamicFeeConfig.decayPeriod,
        reductionFactor: dynamicFeeConfig.reductionFactor,
        variableFeeControl: dynamicFeeConfig.variableFeeControl,
        maxVolatilityAccumulator: dynamicFeeConfig.maxVolatilityAccumulator,
      };
    } else {
      dynamicFee = getDynamicFeeParams(config.dammV2Config.poolFees.minBaseFeeBps);
    }
  }

  const baseFee: BaseFee = getBaseFeeParams(
    maxBaseFeeBps,
    minBaseFeeBps,
    feeSchedulerMode,
    numberOfPeriod,
    totalDuration
  );

  const poolFeesParams: PoolFeesParams = {
    baseFee,
    padding: [],
    dynamicFee,
  };

  const positionNft = Keypair.generate();

  const {
    tx: initCustomizePoolTx,
    pool,
    position,
  } = await cpAmmInstance.createCustomPool({
    payer: wallet.publicKey,
    creator: new PublicKey(config.dammV2Config.creator),
    positionNft: positionNft.publicKey,
    tokenAMint: baseTokenMint,
    tokenBMint: quoteTokenMint,
    tokenAAmount: tokenAAmount,
    tokenBAmount: tokenBAmount,
    sqrtMinPrice: minSqrtPrice,
    sqrtMaxPrice: maxSqrtPrice,
    liquidityDelta: liquidityDelta,
    initSqrtPrice,
    poolFees: poolFeesParams,
    hasAlphaVault: hasAlphaVault,
    activationType,
    collectFeeMode: collectFeeMode,
    activationPoint: activationPoint ? new BN(activationPoint) : null,
    tokenAProgram: baseTokenProgram,
    tokenBProgram: TOKEN_PROGRAM_ID,
  });

  modifyComputeUnitPriceIx(initCustomizePoolTx, config.computeUnitPriceMicroLamports);

  console.log(`\n> Pool address: ${pool}`);
  console.log(`\n> Position address: ${position}`);

  if (config.dryRun) {
    console.log(`> Simulating init pool tx...`);
    await runSimulateTransaction(connection, [wallet.payer, positionNft], wallet.publicKey, [
      initCustomizePoolTx,
    ]);
  } else {
    console.log(`>> Sending init pool transaction...`);
    const initPoolTxHash = await sendAndConfirmTransaction(
      connection,
      initCustomizePoolTx,
      [wallet.payer, positionNft],
      {
        commitment: connection.commitment,
        maxRetries: DEFAULT_SEND_TX_MAX_RETRIES,
      }
    ).catch((err) => {
      console.error(err);
      throw err;
    });
    console.log(`>>> Pool initialized successfully with tx hash: ${initPoolTxHash}`);
  }
}
