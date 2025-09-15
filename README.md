# Meteora Invent Monorepo

Solana DeFi toolkit:

- studio/ – protocol automation & migration scripts
- scaffolds/fun-launch/ – launchpad + /exit flow
- packages/ – shared configs & utilities

## Quick Start

```bash
pnpm install
pnpm build
pnpm dev
```

## Scripts

build • dev • type-check • lint • lint:fix • format • format:check • clean • ci

/exit verification: see EXIT_VERIFICATION.md and PARITY_SUMMARY.md.

## DBC One-Click Exit Overview

The `scaffolds/fun-launch` app exposes a production build `/exit` route implementing a one‑click
claim of accumulated DBC trading fees and withdrawal flow (current prototype focuses on fee claim
transaction structure; full withdraw legs may be extended later). Key pieces:

- UI: `scaffolds/fun-launch/src/app/exit/page.tsx` (stand‑alone page) and a reusable button
	component `DbcOneClickExitButton` for embedding elsewhere.
- Hook: `useDbcInstantExit` orchestrates: optional simulation, build, sign, send, confirm with
	adaptive priority fee escalation (up to 3 attempts, +35% each, cap 3,000,000 microLamports).
- API Route: `/api/dbc-exit` constructs a VersionedTransaction and returns it base64‑encoded plus
	`lastValidBlockHeight`. It supports `simulateOnly` for dry runs and optional `computeUnitLimit`.
- Discovery: `useDbcPoolDiscovery` heuristically lists pools where the wallet appears to have LP
	positions (placeholder logic + known pool registry) so the user can pick a target.

### Exit Options

| Option            | Purpose                                             | Default    |
| ----------------- | --------------------------------------------------- | ---------- |
| priorityMicros    | Base priority fee (microLamports / CU)              | 250,000    |
| slippageBps       | Reserved for future price protection (unused now)  | 50         |
| simulateFirst     | Run a simulation first & capture logs/CU            | true       |
| fastMode          | Skip simulation + processed-first confirm           | false      |
| computeUnitLimit  | Optional explicit CU limit via ComputeBudget        | undefined  |

`fastMode` automatically disables `simulateFirst`; when enabled we attempt a processed commitment
confirmation first (non-blocking) then fall back to confirmed.

### Status Lifecycle

`idle → building → signing → sending → confirming → success` (or `error`). Abort sets
`status=error`, `error=Aborted`.

### Preference Persistence

Exit page & button persist user-selected preferences in `localStorage` keys prefixed with
`dbc-exit-` so they survive reloads.

### Error Normalization

Common raw RPC / on-chain error substrings are mapped to friendly messages (blockhash expired,
slippage, insufficient SOL, no claimable fees) inside `parseErrorMessage` in the hook.

For deep verification & test scripts see `EXIT_VERIFICATION.md`.

### Environment Configuration (DBC)

Set the following to align with the live Meteora deployment:

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `DBC_PROGRAM_ID` | Override program id for DBC (fee claim) | `dbcij3LWUppWqq96...` (fallback) |
| `DBC_CLAIM_FEE_DISCRIMINATOR` | 8-byte hex (little-endian) discriminator for claim fee ix | `0102030405060708` placeholder |

If the real discriminator is not supplied the builder will still create an instruction but it will NOT execute successfully on-chain. Replace the placeholder with production value once confirmed from Meteora docs / IDL.

### Builder Internals

`scaffolds/fun-launch/src/server/dbc-exit-builder.ts` centralizes transaction assembly:

- Validates pool + fee vault and extracts SPL token mint.
- Creates (idempotent) destination ATA for claimer.
- Applies optional compute budget (price + limit) instructions.
- Inserts DBC claim fee instruction (placeholder discriminator until real one configured).
- Supports simulation mode; returns logs + CU usage.

The API route now delegates to this builder, ensuring consistent logic for both simulation and execution.
