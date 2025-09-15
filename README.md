# Meteora Invent Monorepo

[![CI](https://github.com/MinscoVFX/therebelion/actions/workflows/ci.yml/badge.svg)](https://github.com/MinscoVFX/therebelion/actions/workflows/ci.yml)

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

Reference docs: Meteora DBC – https://docs.meteora.ag/overview/products/dbc/what-is-dbc

Reference Meteora DBC documentation: https://docs.meteora.ag/overview/products/dbc/what-is-dbc

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

## Auto Batch Exit (Prototype)

An optional prototype feature lets a user process every discovered DBC position sequentially with one
action. Enable the toggle on the `/exit` page: "Auto Batch Exit (all positions)". When active:

- Discovery is performed via `/api/dbc-discover` (LP + NFT heuristics) and a claim-fee transaction is
  built for each position (current placeholder mode = `claim`).
- Transactions are built server-side via the same `/api/dbc-exit` builder (non-simulated for speed),
  then signed client-side and dispatched sequentially.
- Per-position status life‑cycle: `pending → signed → sent → confirmed | error` with signature links.
- Abort stops further processing but already confirmed signatures remain.

Limitations / Roadmap:

1. Full liquidity withdrawal legs not yet attached (awaiting authoritative exit instruction + final
	discriminator(s)).
2. No adaptive priority escalation per item (single exit hook already implements; planned parity).
3. Concurrency deliberately = 1 for simplicity; future enhancement may allow small parallelism.
4. Placeholder claim instruction uses `DBC_CLAIM_FEE_DISCRIMINATOR`; ensure you configure the real
	8‑byte value before expecting on‑chain success.

Configuration & Persistence:

| Aspect            | Detail                                  |
| ----------------- | ---------------------------------------- |
| Toggle Storage    | `localStorage['dbc-auto-exit-enabled']`  |
| Hook              | `useDbcAutoBatchExit`                    |
| Status UI Source  | `exit/page.tsx` batch table section      |
| Mode Field        | Currently fixed to `claim`               |

Abort Semantics: The active transaction in flight is not forcibly cancelled (Solana lacks that primitive);
we simply stop building/sending the next ones and mark batch `running=false`.

Security Note: Because multiple signed transactions are dispatched, ensure the page is trusted and the
builder never introduces unvetted program IDs. A future enhancement will implement an allow‑list.
