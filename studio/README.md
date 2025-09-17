# Meteora Studio

A collection of scripts for interacting with Meteora's programs to innovate and create token
launches. Part of the **Meteora Invent** toolkit - the most secure, sustainable and composable
liquidity layer on Solana.

## 🏗️ Structure

Studio consists of 4 main pool types, each with dedicated scripts and configurations:

- **DLMM** (Dynamic Liquidity Market Maker) - Dynamic fees and precise liquidity concentration
- **DAMM V2** (Dynamic AMM V2) - Enhanced constant product AMM with advanced features
- **DAMM V1** (Dynamic AMM V1) - Constant product AMM with lending integration
- **DBC** (Dynamic Bonding Curve) - Permissionless launch pool protocol

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 9.0.0

### Installation

From the root of the meteora-invent repository:

```bash
# Install all dependencies
pnpm install
```

### Configuration

1. Copy the `.env.example` file to `.env` and configure the environment variables:

```bash
cp studio/.env.example studio/.env
```

Add your private key and RPC URL to the `.env` file. RPC is optional but highly encouraged. Visit
[Helius](https://www.helius.dev/) to get an RPC URL.

2. Generate a keypair from your private key:

```bash
pnpm studio generate-keypair
```

3. Configure the config files in the `studio/config` directory:

- [DLMM Config](./config/dlmm_config.jsonc)
- [DAMM v2 Config](./config/damm_v2_config.jsonc)
- [DAMM v1 Config](./config/damm_v1_config.jsonc)
- [DBC Config](./config/dbc_config.jsonc)

**Note:** You can use the provided example configurations as a starting point. Make sure to replace
the placeholders with your actual values.

## 📋 Available Scripts

### DLMM Scripts

**Create a Customizable Permissionless DLMM Pool**

```bash
pnpm dlmm-create-pool --config ./config/dlmm_config.jsonc
```

**Seed Liquidity (LFG)**

```bash
pnpm dlmm-seed-liquidity-lfg --config ./config/dlmm_config.jsonc
```

**Seed Liquidity (Single Bin)**

```bash
pnpm dlmm-seed-liquidity-single-bin --config ./config/dlmm_config.jsonc
```

**Set DLMM Pool Status**

```bash
pnpm dlmm-set-pool-status --config ./config/dlmm_config.jsonc
```

### DAMM v2 Scripts

**Create a Balanced Constant Product Pool**

```bash
pnpm damm-v2-create-balanced-pool --config ./config/damm_v2_config.jsonc
```

**Create a One-Sided Pool**

```bash
pnpm damm-v2-create-one-sided-pool --config ./config/damm_v2_config.jsonc
```

**Remove Liquidity (Programmatic Builder)**

While removal is typically handled by frontends, a low-level helper `buildRemoveLiquidityIx` is
exported by `@meteora-invent/studio/lib/damm_v2` to compose removal instructions server-side.

Example (pseudo-code):

```ts
import { buildRemoveLiquidityIx } from '@meteora-invent/studio/lib/damm_v2';
// ... obtain connection & all required public keys ...
const ixs = await buildRemoveLiquidityIx({
  connection,
  programId, // DAMM v2 program id
  pool, // pool address
  lpMint, // LP mint
  user, // wallet owner
  userLpAccount, // user's LP token account
  userAToken, // user's token A ATA
  userBToken, // user's token B ATA
  tokenAMint,
  tokenBMint,
  tokenAVault,
  tokenBVault,
  // Removal amount can be specified in one of four ways (priority order):
  // 1. liquidityDelta (advanced raw liquidity units)
  // 2. percent (e.g. 25 for 25%)
  // 3. lpAmount (legacy param kept for backward compatibility)
  // 4. omit all -> remove 100% of discovered position liquidity
  percent: 25, // remove 25% of position liquidity
  // lpAmount: 1000n,
  // liquidityDelta: 123456789n,
  // positionPubkey: someSpecificPosition, // optional explicit position; skips discovery
});
```

Returned value is an array of `TransactionInstruction` you can embed into a transaction.

> NOTES:
>
> - If `positionPubkey` is provided discovery is skipped.
> - If multiple sizing fields are provided, precedence is: `liquidityDelta` > `percent` >
>   `lpAmount`.
> - If none of `lpAmount | percent | liquidityDelta` are provided the builder removes 100% of the
>   position liquidity.

### DAMM v1 Scripts

**Create a Constant Product Pool**

```bash
pnpm damm-v1-create-pool --config ./config/damm_v1_config.jsonc
```

### Performance & Native Binding Notes

During builds you may observe messages related to loading `next-swc` native bindings or wasm
fallbacks. This originates from Next.js attempting to load platform-specific Rust compiled binaries.
If it falls back to wasm you still get correct behavior, only slightly slower incremental builds.

Tips:

1. Keep your workspace architecture aligned with the lockfile generation platform (avoid mixing
   arm64 vs x64 artifacts).
2. To force wasm only (diagnostic) you can set `NEXT_DISABLE_SWC_WASM=1` but generally you want
   native.
3. Ensure no container volume permissions prevent loading `.node` binary files inside `@next/swc-*`
   packages.
4. For CI, prefer a clean `pnpm install --frozen-lockfile` per architecture to avoid stale native
   artifacts.

You can introspect which flavor loaded at runtime by adding a small check (example only):

```ts
import { getBinaryMetadata } from 'next/dist/build/swc';
console.log('swc target triple:', getBinaryMetadata().target);
```

If `target` is undefined you are likely on the wasm fallback.

**Lock Liquidity**

```bash
pnpm damm-v1-lock-liquidity --config ./config/damm_v1_config.jsonc
```

**Create a Stake2Earn Farm**

```bash
pnpm damm-v1-create-stake2earn-farm --config ./config/damm_v1_config.jsonc
```

**Lock Liquidity (Stake2Earn)**

```bash
pnpm damm-v1-lock-liquidity-stake2earn --config ./config/damm_v1_config.jsonc
```

### DBC Scripts

**Create a DBC Config**

```bash
pnpm dbc-create-config --config ./config/dbc_config.jsonc
```

**Create a DBC Pool**

```bash
pnpm dbc-create-pool --config ./config/dbc_config.jsonc
```

**Claim Trading Fees**

```bash
pnpm dbc-claim-trading-fee --config ./config/dbc_config.jsonc
```

**Migrate to DAMM v1**

```bash
pnpm dbc-migrate-to-damm-v1 --config ./config/dbc_config.jsonc
```

**Migrate to DAMM v2**

```bash
pnpm dbc-migrate-to-damm-v2 --config ./config/dbc_config.jsonc
```

**Swap (Buy/Sell)**

```bash
pnpm dbc-swap --config ./config/dbc_config.jsonc
```

## 🩺 Runtime Health (Scaffold)

In the `fun-launch` scaffold a `/api/runtime-health` endpoint reports availability of the Studio
runtime submodules (`damm_v2`, `dbc`). This is useful for deployment diagnostics when dynamic
imports fail. The endpoint returns a JSON object like:

```json
{ "damm_v2": true, "dbc": true }
```

If a value is `false`, ensure the Studio package is built
(`pnpm --filter @meteora-invent/studio build`).

## 📖 Program Details

### Dynamic Bonding Curve (DBC)

The Dynamic Bonding Curve (DBC) program is a permissionless launch pool protocol that allows any
launch partners to enable their users to launch tokens with customizable virtual curves directly on
their platform (e.g. launchpad). This allows their users to create a new token and create a Dynamic
Bonding Curve pool where anyone can buy tokens based on that bonding curve.

### Dynamic AMM V1 (DAMM V1)

Constant product AMM that supports token prices from 0 to infinity. LPs can earn additional yield by
utilizing lending sources alongside traditional swap fees, enhancing their returns.

### Dynamic AMM V2 (DAMM V2)

Dynamic AMM v2 is a constant-product AMM program, with features that optimize transaction fees and
provide greater flexibility for liquidity providers, launchpads, and token launches. DAMM v2 comes
with SPL and Token 2022 token support, optional concentrated liquidity, position NFT, dynamic fee,
on-chain fee scheduler, new fee claiming mechanism and fee token selection, more flexible liquidity
locks, and an in-built farming mechanism. Unlike DAMM v1, DAMM v2 is not integrated with Dynamic
Vaults. DAMM v2 is a new program, and not an upgrade of the Dynamic AMM v1 program.

### Dynamic Liquidity Market Maker (DLMM)

DLMM (Dynamic Liquidity Market Maker) gives LPs access to dynamic fees to capitalize on volatility,
and precise liquidity concentration all in real-time, with the flexibility to select their preferred
volatility strategy.

## 🤝 Contributing

For contributing guidelines, please refer to the main [CONTRIBUTING.md](../CONTRIBUTING.md) file in
the root repository.

## 📄 License

This project is licensed under the ISC License - see the [LICENSE.md](../LICENSE.md) file for
details.
