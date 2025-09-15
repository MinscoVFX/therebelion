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

build • dev • type-check • lint • lint:fix • format • format:check • clean • ci • health • env:check • health:full

`pnpm health` runs a consolidated preflight: typecheck + lint + tests (run mode) and serves as a quick
verification gate before commits or deployments. `pnpm env:check` performs static environment validation
(placeholder discriminator, required variables, allow‑list formatting). `pnpm health:full` runs both in sequence.

Environment template: see `.env.example` for all supported variables (including
`DBC_SUPPRESS_PLACEHOLDER_WARNING` for local development log noise suppression).

/exit verification: see EXIT_VERIFICATION.md and PARITY_SUMMARY.md.

### Health API

A lightweight runtime health endpoint is exposed at: `GET /api/health` within the fun-launch Next.js app.
It accepts any of the RPC env variable names (`RPC_URL`, `RPC_ENDPOINT`, or `NEXT_PUBLIC_RPC_URL`) and reports which one was detected. It returns JSON:

```json
{
  "service": "fun-launch",
  "time": "2025-09-15T00:00:00.000Z",
  "commit": "abcdef1",
  "env": {
    "ok": true,
    "warnings": ["Using placeholder DBC_CLAIM_FEE_DISCRIMINATOR"],
    "errors": [],
    "details": {"RPC_ENDPOINT": "present"}
  }
}
```

Status code is 200 when `ok=true` else 500 if any blocking errors (e.g., placeholder discriminator in production or missing required envs).

Add this route to uptime monitoring for early detection of misconfiguration before users hit /exit.

## Vercel Setup

Deploy the `scaffolds/fun-launch` app via Vercel (root monorepo). Ensure the following environment variables are configured in the Vercel Project (Production + Preview as needed):

Required:
 - `POOL_CONFIG_KEY`
 - One of: `RPC_ENDPOINT` OR `NEXT_PUBLIC_RPC_URL` (public) OR `RPC_URL` (legacy)
 - One of (highest precedence first):
   1. `DBC_CLAIM_FEE_DISCRIMINATOR` (16 hex chars)
   2. `DBC_CLAIM_FEE_INSTRUCTION_NAME` (Anchor ix name)
   3. `DBC_USE_IDL=true` plus an uploaded `dbc_idl.json` in the repo root

Optional / Recommended:
 - `DBC_PROGRAM_ID` (override if different from default)
 - `ALLOWED_DBC_PROGRAM_IDS` (comma-separated allow list)
 - `DBC_USE_IDL` (set `true` to auto-derive from IDL)
 - `ALLOW_PLACEHOLDER_DBC` (ONLY for temporary staging bypass)

The health endpoint `/api/health` must return `{"ok": true}` in Production. Any warning about placeholder discriminators must be resolved before launch. A failing health response (HTTP 500) blocks go‑live.

Build Configuration:
 - Root `vercel.json` specifies Node 20 runtime for API functions.
 - Build command: `pnpm -w build` (workspace build) ensures shared packages are compiled before Next build.

Troubleshooting:
 - 500 on `/api/dbc-exit`: check logs for discriminator resolution error; ensure one of the envs or IDL path is set.
 - Simulation errors: confirm the fee vault account and pool keys are correct; verify RPC performance.
 - Placeholder warning persists: confirm the real 8‑byte hex differs from `0102030405060708` and no stray whitespace.

Never commit real private keys or secrets. Only public program IDs and configuration values belong in env vars.

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

Copy `.env.example` to `.env.local` and fill in the real values:

| Variable | Purpose | Default / Behavior |
| -------- | ------- | ------------------ |
| `DBC_PROGRAM_ID` | Override program id for DBC (fee claim) | Fallback to `dbcij3LWUppWqq96...` if unset |
| `DBC_CLAIM_FEE_DISCRIMINATOR` | 8-byte hex (little-endian) discriminator for claim fee ix (explicit override – highest precedence) | Placeholder `0102030405060708` if unset |
| `DBC_CLAIM_FEE_INSTRUCTION_NAME` | Anchor instruction name (e.g. `claim_partner_trading_fee`) to auto-derive discriminator using `sha256("global::<name>")` first 8 bytes | Used if explicit hex not set |
| `DBC_SUPPRESS_PLACEHOLDER_WARNING` | If `true`, silences console warning when placeholder discriminator is in use (dev only) | `false` |
| `ALLOWED_DBC_PROGRAM_IDS` | Comma-separated allow list of permitted DBC program IDs (safety gate) | (unset = allow any) |
| (future) `DBC_WITHDRAW_LIQUIDITY_DISCRIMINATOR` | 8-byte hex for withdraw instruction (not yet active) | (unset) |
| `ALLOW_PLACEHOLDER_DBC` | Bypass prod guard (NOT recommended) | Must be set to `true` explicitly |
| `DBC_USE_IDL` | If `true`, attempt to load `dbc_idl.json` and auto-derive discriminators | `false` |
| `dbc_idl.json` | Optional Anchor-style IDL file at repo root | Not present by default |

Production Guard: In `NODE_ENV=production`, if the placeholder discriminator is still present the builder throws unless you deliberately set `ALLOW_PLACEHOLDER_DBC=true`. You can supply ANY of the following (checked in order) to avoid placeholder usage:

1. `DBC_CLAIM_FEE_DISCRIMINATOR` (explicit hex)
2. `DBC_CLAIM_FEE_INSTRUCTION_NAME` (auto-derived Anchor hash)
3. `DBC_USE_IDL=true` with `dbc_idl.json` present

Action Parameter (`claim` | `withdraw`): The builder & API accept an `action` field. `withdraw` currently throws `DBC withdraw (liquidity removal) is not implemented yet` until the official DBC IDL / instruction layout is supplied. UI presents the option disabled for clarity.

IDL Auto Mode: When `DBC_USE_IDL=true` and a `dbc_idl.json` file exists:

1. The builder parses the IDL and derives each instruction discriminator with Anchor formula `sha256("global::<name>").slice(0,8)`.
2. For the generic `claim` action it prefers `claim_partner_trading_fee` then `claim_creator_trading_fee`.
3. The withdraw stub error includes any withdraw-like instruction name & listed accounts to guide integration.
4. If IDL load fails it silently falls back to env / placeholder behavior.

How to obtain the real discriminator (Anchor-style): `sha256("global::<instruction_name>")` → take first 16 hex chars (8 bytes). This is automated if you set `DBC_CLAIM_FEE_INSTRUCTION_NAME`.

### Builder Internals

`scaffolds/fun-launch/src/server/dbc-exit-builder.ts` centralizes transaction assembly:

- Validates pool + fee vault and extracts SPL token mint.
- Creates (idempotent) destination ATA for claimer.
- Applies optional compute budget (price + limit) instructions.
- Inserts DBC claim fee instruction (placeholder discriminator until real one configured). A withdraw path stub exists but is intentionally guarded.
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

## Universal Exit (DBC + DAMM v2)

The beta Universal Exit flow extends the original DBC one‑click claim to also:

1. Claim DBC trading fees for every discovered DBC position (as before).
2. Remove 100% liquidity from each discovered DAMM v2 position (full withdrawal) using the cp‑amm SDK.

It plans both sets of transactions first, then signs & submits them sequentially, tracking per‑tx status.

### Components

| Component | Path | Purpose |
| --------- | ---- | ------- |
| Planner | `scaffolds/fun-launch/src/hooks/universalExitPlanner.ts` | Discovers positions (DBC + DAMM v2) and builds transactions via server APIs. |
| Hook | `scaffolds/fun-launch/src/hooks/useUniversalExit.ts` | Executes planned transactions sequentially (sign → send → confirm). |
| UI | `scaffolds/fun-launch/src/app/exit/page.tsx` | Adds the "Universal Exit All" button + progress list. |
| APIs | `/api/dbc-discover`, `/api/dbc-exit`, `/api/dammv2-discover`, `/api/dammv2-exit`, `/api/dammv2-exit-all` | Discovery & tx assembly backends (single & bulk). |

### Status Lifecycle

`planning → pending → signed → sent → confirmed | error` per item.

### Failure Isolation

If one position build or send fails, it is marked `error` and the flow continues with remaining tasks (best‑effort philosophy). Abort stops further processing after the in‑flight transaction completes (cannot cancel already sent tx on Solana).

### Current Limitations

| Area | Limitation | Planned Improvement |
| ---- | ---------- | ------------------ |
| DBC withdraw | Still placeholder; only fee claim executed | Replace when official withdraw instruction confirmed |
| DAMM v2 partial exit | Always 100% removal (percent=100) | Add per‑position %, quoting + slippage thresholds |
| Migrated pool detection | Env list only (`MIGRATED_DBC_POOLS`) | On-chain metadata (migration PDA) auto-detection |
| Parallelism | Serial execution (one at a time) | Optional small (N=2–3) concurrency | 
| Slippage protection | None for DAMM v2 withdraw builder | Integrate withdraw quote thresholds robustly |
| Priority adaptation | Fixed base priorityMicros | Integrate adaptive escalation like single exit hook |

### Safety Guards

- DBC claim still blocked in production if placeholder discriminator unless `ALLOW_PLACEHOLDER_DBC=true`.
- Builder clamps priority fee microLamports to `[0, 3_000_000]`.
- Invalid / failing build requests are skipped with console warnings (not fatal to whole batch).

### Testing

Unit test `tests/universalExitPlanner.test.ts` validates dual‑protocol planning and include filters. Full end‑to‑end requires connected wallet & real chain accounts (see `EXIT_VERIFICATION.md` for manual checklist; universal exit semantics mirror batch + single flows combined).

### Example (Conceptual)

```
// Trigger universal exit
const { state, run } = useUniversalExit();
run({ priorityMicros: 250_000 });
```

`state.items` will populate with mixed `dbc` (claim) and `dammv2` (withdraw) tasks.

### Environment Variables (Additional)

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `MIGRATED_DBC_POOLS` | Comma-separated list of DAMM v2 pool addresses considered migrated from DBC (used when `migratedOnly=true` on `/api/dammv2-exit-all`) | Temporary until PDA-based auto-detect implemented |
| (reuse) `RPC_URL` / `NEXT_PUBLIC_RPC_URL` | RPC endpoint(s) | Auto-detected precedence |

Future additions (e.g., `UNIVERSAL_EXIT_MAX_CONCURRENCY`) may be added when parallelism is implemented.

### Roadmap (Universal Exit)

1. Add DBC withdraw once authoritative instruction layout (IDL) available.
2. Add per‑protocol adaptive priority escalation.
3. Persist per‑session summary (success/fail counts + signatures) to localStorage for audit.
4. Optional safe‑mode simulation pass for DAMM v2 before executing (opt‑in).
5. Program allow‑list + signature domain tagging for enhanced safety.
6. Replace static `MIGRATED_DBC_POOLS` list with dynamic on-chain migration metadata scanning.

### Wallet Batch Signing Optimization

If the connected wallet (e.g., Phantom, Solflare, Backpack) supports `signAllTransactions`, the batch + universal exit flows automatically attempt a single approval for all prepared transactions. If the batch call fails or isn’t supported, the code falls back to individual `signTransaction` prompts per transaction. Individual failures in fallback mode do not abort the rest of the batch; they are recorded with status `error` and execution proceeds.

## Dark Theme Exit UI

The `/exit` page has been refactored to a fully dark, high‑contrast palette to meet production accessibility and branding goals (no white panels or low‑contrast gray text). Key design notes:

- Base surfaces: `neutral-900` (page) and `neutral-850` (cards) with subtle `neutral-700/60` borders.
- Accent feedback: indigo (info / in‑progress), emerald (success), rose (error), amber (pending / attention).
- Status chips & badges use translucent overlays (e.g. `bg-indigo-500/10` + border) for better layering on dark backgrounds without harsh saturation.
- Radio inputs & checkboxes adopt `accent-indigo-500` for consistent interaction color.
- Error & simulation log panels replaced red/blue light backgrounds with tinted overlays (e.g. `bg-rose-500/10`).
- All interactive elements retain visible focus (`focus:ring-indigo-400/60` etc.) for keyboard accessibility.

No structural or logical changes were made—purely class substitutions. Tests remain green (see CI badge) confirming functional invariants unaffected.

Future enhancement ideas:
1. Optional light/dark theme toggle with CSS variables (would require extracting Tailwind tokens to custom properties).
2. Reduced motion mode for progress animations.
3. Add aria-live region for batch/universal status stream (planned in accessibility follow-up).
4. Integrate DAMM v2 withdraw-all progress into universal planner (currently separate for clarity).

## DAMM v2 One-Click Withdraw All

Endpoint: `POST /api/dammv2-exit-all`

Purpose: Build full-liquidity removal transactions (one per position) for every DAMM v2 position owned by the connected wallet, enabling a single multi-sign approval flow.

Input JSON fields:
| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| owner | string | (required) | Wallet public key base58 |
| migratedOnly | boolean | false | Filter positions to pools in `MIGRATED_DBC_POOLS` env list |
| priorityMicros | number | 250000 | Priority fee (μLamports / CU) clamped to 3,000,000 |
| simulateOnly | boolean | false | If true, run simulation per tx and return logs without executing |

Response:
```
{
  positions: [{ position, pool, status, reason?, signature? }],
  txs: [base64VersionedTx...],
  lastValidBlockHeight
}
```

Status / Reason semantics (skips):
| Code | Meaning |
| ---- | ------- |
| zero-liquidity | Position had no remaining liquidity |
| no-builder | Neither removeAllLiquidity nor removeLiquidity available |
| builder-failed:* | SDK threw during builder construction |
| extract-failed:* | Could not extract instructions from builder object |
| simulation-error | Simulation produced an error |

Client Hook: `useDammV2ExitAll` attempts `signAllTransactions`; falls back to per-transaction signing, updates UI progress panel.

Roadmap:
1. Instruction packing (multiple positions per tx when safe).
2. Slippage / min-out thresholds.
3. Vesting / locked detection (skip or partial strategies).
4. Authority double-check against position account owner for defense-in-depth.
5. Converge with Universal Exit planner post hardening.



