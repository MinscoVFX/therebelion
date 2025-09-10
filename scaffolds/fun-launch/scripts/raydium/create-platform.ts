  // Raydium expects some fee/split params as "bps × 100"
  const feeRateX100 = Number(env('RAYDIUM_SHARE_FEE_BPS', false) || '20') * 100;
  const creatorFeeRateX100 = 0;

  const platformScaleX100 = Number(env('RAYDIUM_MIGRATE_SPLIT_PLATFORM_BPS', false) || '0') * 100;
  const creatorScaleX100  = Number(env('RAYDIUM_MIGRATE_SPLIT_CREATOR_BPS', false) || '10000') * 100;
  const burnScaleX100     = Number(env('RAYDIUM_MIGRATE_SPLIT_BURN_BPS', false) || '0') * 100;

  // Optional branding (can trigger Buffer.from(undefined) in some SDK builds)
  const name = process.env.NEXT_PUBLIC_SITE_NAME ?? '';
  const web  = process.env.PUBLIC_BUCKET_URL ?? '';
  const img  = process.env.R2_PUBLIC_BASE ? `${process.env.R2_PUBLIC_BASE}/logo.png` : '';

  const createFn =
    sdk.createPlatformConfig ??
    sdk.createPlatormConfig ??
    sdk.LaunchLab?.createPlatformConfig ??
    sdk.PlatformConfig?.create;

  if (typeof createFn !== 'function') {
    throw new Error('Raydium SDK: createPlatformConfig function not found in this version');
  }

  const cpConfigIdDevnet = new PublicKey('EsTevfacYXpuho5VBuzBjDZi8dtWidGnXoSYAr8krTvz');

  // ✅ Build MINIMAL config: only required numeric fields; avoid optional strings
  const config: any = {
    feeRate: feeRateX100,
    creatorFeeRate: creatorFeeRateX100,
    migrateCpLockNftScale: {
      platformScale: platformScaleX100,
      creatorScale:  creatorScaleX100,
      burnScale:     burnScaleX100,
    },
  };

  // Only add cpConfigId for devnet OR if you know a valid mainnet ID
  if (RPC_URL.includes('devnet')) {
    config.cpConfigId = cpConfigIdDevnet;
  }

  const args = {
    connection: conn,
    owner: authority,
    programId,
    config,
  };

  const result = await createFn(args);
