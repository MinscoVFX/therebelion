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
