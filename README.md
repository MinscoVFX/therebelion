# Meteora Invent Monorepo

[![CI](https://github.com/MinscoVFX/therebelion/actions/workflows/ci.yml/badge.svg)](https://github.com/MinscoVFX/therebelion/actions/workflows/ci.yml)
![Coverage](https://img.shields.io/badge/coverage-25%25-lightgreen)

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

## Deployment (Vercel)

Minimal production deployment uses the `scaffolds/fun-launch` Next.js app. Ensure the repo root (monorepo) is connected. Vercel will detect Next.js automatically; `vercel.json` pins build commands. Set these Environment Variables (Project → Settings → Environment Variables):

Required (Production + Preview):
- RPC_URL (or RPC_ENDPOINT or NEXT_PUBLIC_RPC_URL) – choose one canonical RPC; for client availability also set NEXT_PUBLIC_RPC_URL
- ALLOWED_DBC_PROGRAM_IDS – JSON array including official id(s), e.g. ["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"]
- ALLOWED_DAMM_V2_PROGRAM_IDS – JSON array including official id(s), e.g. ["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"]
- DBC_CLAIM_FEE_DISCRIMINATOR or DBC_CLAIM_FEE_INSTRUCTION_NAME (or enable IDL via DBC_USE_IDL=true)

Optional:
- DBC_USE_IDL=true (auto derive discriminators if `dbc_idl.json` present)
- DBC_CLAIM_FEE_INSTRUCTION_NAME=claim_fee (short-form) if you prefer name over explicit hex
- MIGRATED_DBC_POOLS (comma list) for migrated filter in DAMM v2 exit-all

Do NOT deploy with placeholder discriminators (ffffffffffffffff, eeeeeeeeeeeeeeee, 0000000000000000); the server will throw in production.

Post-deploy validation checklist:
1. Visit /api/health – JSON shows ok:true and which RPC var detected.
2. Visit /exit – open devtools console; no placeholder discriminator warning.
3. Trigger a simulation (simulateOnly default) – receives logs & unitsConsumed.
4. Build a claim – server returns base64 tx.

If any failure occurs re-check env names (Vercel upper-case) and redeploy. Lint/typecheck/test must be green (see CI badge) before relying on build artifacts.

## Scripts

build • dev • type-check • lint • lint:fix • format • format:check • clean • ci • health • env:check • health:full

`pnpm health` runs a consolidated preflight: typecheck + lint + tests (run mode) and serves as a quick
verification gate before commits or deployments. `pnpm env:check` performs static environment validation
(placeholder discriminator, required variables, allow‑list formatting). `pnpm health:full` runs both in sequence.

Environment template: see `.env.example` for all supported variables (including
`DBC_SUPPRESS_PLACEHOLDER_WARNING` for local development log noise suppression).

### Coverage

Unit test coverage is generated via Vitest (v8 provider). To run locally:

```bash
pnpm coverage
```

Artifacts (`lcov.info` + `coverage-summary.json`) are uploaded in CI. Once a coverage reporting service or threshold badge is integrated, replace the placeholder badge at the top.

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

## Vercel Setup (RPC Aliases)

Set the following Environment Variables in Vercel (Project → Settings → Environment Variables) for all environments (Preview + Production):

| Key | Value | Notes |
| --- | ----- | ----- |
| `RPC_ENDPOINT` | (Your Helius RPC URL) | Primary server-side resolution key |
| `NEXT_PUBLIC_RPC_URL` | (Same Helius RPC URL) | Exposed to client where needed |
| `RPC_URL` | (Same Helius RPC URL) | Optional legacy; resolver accepts any of the three |
| `DBC_USE_IDL` | `true` | Enables IDL-based discriminator derivation in production |
| `POOL_CONFIG_KEY` | `<base58>` | Required existing variable (kept for exit logic) |

Runtime now resolves the RPC via:

```ts
process.env.RPC_ENDPOINT || process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL
```

If none are set the server throws: `RPC endpoint missing (RPC_ENDPOINT/RPC_URL/NEXT_PUBLIC_RPC_URL)`.

After setting variables trigger a redeploy. Verify with `GET /api/health` that at least one `HAS_RPC_*` flag is `true` and `env.ok` is `true`.

## DBC One-Click Exit Overview

Reference docs: Meteora DBC – https://docs.meteora.ag/overview/products/dbc/what-is-dbc

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
| `DBC_CLAIM_FEE_DISCRIMINATOR` | 8-byte hex (16 hex chars) discriminator for claim fee ix (explicit override – highest precedence) | REQUIRED unless using NAME or IDL |
| `DBC_CLAIM_FEE_INSTRUCTION_NAME` | Anchor instruction name (e.g. `claim_partner_trading_fee`, `claim_creator_trading_fee`, or short form `claim_fee`) to derive discriminator (sha256("global::<instruction_name>").slice(0,8)) | Optional (used if explicit hex unset) |
| `ALLOWED_DBC_PROGRAM_IDS` | Comma-separated allow list of permitted DBC program IDs (safety gate) | (unset = allow any) |
| `DBC_WITHDRAW_DISCRIMINATOR` | 8-byte hex for withdraw instruction | REQUIRED unless using NAME or IDL |
| `DBC_WITHDRAW_INSTRUCTION_NAME` | Anchor instruction name to derive withdraw discriminator | Optional (used if explicit hex unset) |
| `DBC_USE_IDL` | If `true`, attempt to load `dbc_idl.json` and auto-derive both discriminators | false |
| `dbc_idl.json` | Anchor-style IDL file at repo root (enables IDL derivation) | Optional |
| `ALLOW_PLACEHOLDER_DBC` | (Deprecated) Was used to allow placeholder discriminators; now discouraged and not needed | Avoid using |

Production Guard: Builders now REQUIRE a real discriminator for both claim and withdraw. Provide either an explicit hex or instruction name (or enable IDL). If none are found the server throws on startup/import.

Action Parameter (`claim` | `withdraw`): Both actions require valid discriminators. Withdraw account layout may still be provisional—ensure you test on devnet/mainnet with real pools before production rollout.

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

### API Exit Build (Unified)

Endpoint: `POST /api/exit/build`

Purpose: Build compute budget instructions and (optionally) a DBC exit transaction (currently fee claim; withdraw path will activate once official layout confirmed).

Request Body (JSON):

```ts
{
  "cuLimit": 600000,                // optional compute unit limit (clamped 50k–1.4M)
  "microLamports": 250000,          // priority fee (μLamports per CU, clamped 0–3,000,000)
  "owner": "<walletPubkey>",       // required for DBC claim build
  "dbcPoolKeys": {                  // required for DBC claim build
    "pool": "<poolPubkey>",
    "feeVault": "<feeVaultTokenAccountPubkey>"
  },
  "action": "claim",               // 'claim' | 'withdraw' | 'claim_and_withdraw' (withdraw pending)
  "simulateOnly": true              // default true for safety if DBC params supplied
}
```

Response (success with DBC build):

```ts
{
  "ok": true,
  "cuLimit": 600000,
  "microLamports": 250000,
  "computeBudgetIxs": [ { /* CU limit ix */ }, { /* CU price ix */ } ],
  "exitTxBase64": "<base64 versioned tx>",
  "simulation": { "logs": [], "unitsConsumed": 5000 }
}
```

If only fee parameters supplied (no DBC keys), the route returns compute budget data sans `exitTxBase64`.

Failure (e.g., missing discriminator):

```json
{ "ok": false, "cuLimit": 600000, "microLamports": 250000, "error": "Missing claim discriminator: ..." }
```

Mock Mode: Set `TEST_MOCK_RPC=mock` (never in production) to force an in-memory connection with deterministic blockhash, account info (fake SPL account data), and simulation result (5,000 CU). Used by integration tests (`tests/exitBuildDbcIntegration.test.ts`).

Discriminator Precedence (claim & withdraw):

1. Explicit hex env (`DBC_CLAIM_FEE_DISCRIMINATOR` / `DBC_WITHDRAW_DISCRIMINATOR`)
2. Instruction name env (`DBC_CLAIM_FEE_INSTRUCTION_NAME` / `DBC_WITHDRAW_INSTRUCTION_NAME`)
3. IDL auto mode when `DBC_USE_IDL=true` and `dbc_idl.json` present
4. (Error) – request fails with 400 (runtime) or throws early (import path) if missing

Production Safety: Placeholder discriminators are fully disallowed—supply real values prior to public launch.

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

### Status Lifecycle (Universal Exit)

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

```ts
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

```json
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

## Mainnet Usage Checklist

To run the production `/exit` and unified `/api/exit/build` endpoints safely on mainnet:

1. Provide a high-availability Solana RPC (Helius, Triton, Syndica, etc.). Set at least one of: `RPC_ENDPOINT`, `RPC_URL`, or `NEXT_PUBLIC_RPC_URL`.
2. Populate DBC discriminators via one (and only one) strategy:
   - Explicit hex: set `DBC_CLAIM_FEE_DISCRIMINATOR` (and `DBC_WITHDRAW_DISCRIMINATOR` when withdraw supported), OR
   - Instruction names: set `DBC_CLAIM_FEE_INSTRUCTION_NAME` (and future withdraw name) to a supported Anchor instruction, OR
   - IDL mode: set `DBC_USE_IDL=true` and provide `dbc_idl.json`.
3. Enforce allow-lists:
   - `ALLOWED_DBC_PROGRAM_IDS` must JSON-encode an array containing the official program id.
   - `ALLOWED_DAMM_V2_PROGRAM_IDS` must JSON-encode an array containing the official DAMM v2 id.
4. Remove any placeholder discriminators before deployment; runtime throws in production if missing/invalid.
5. Monitor `GET /api/health` post-deploy; ensure `ok=true` and no placeholder warnings.
6. Keep priority fee defaults conservative (250k μLamports/CU) and clamp upper bounds (code already enforces 3,000,000).
7. Set up alerting for anomalies (elevated simulation errors, sudden tx CU spikes) using your infra provider.

Minimal required env set (example production `.env` fragment):

```bash
RPC_ENDPOINT=https://mainnet.helius-rpc.example
ALLOWED_DBC_PROGRAM_IDS=["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"]
ALLOWED_DAMM_V2_PROGRAM_IDS=["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"]
DBC_USE_IDL=true
# or explicit
# DBC_CLAIM_FEE_DISCRIMINATOR=0123abcd89ef4567
```

### Unified Exit Build API (`POST /api/exit/build`)

Generates compute budget instructions and (optionally) a DBC claim transaction in one response.

Body fields:

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| owner | string | yes | Wallet public key (base58) used as fee + signing authority |
| priorityMicros | number | no | Priority fee per CU (μLamports) default 250000 |
| computeUnitLimit | number | no | Override CU limit (default 600k) |
| dbcPoolKeys | object | conditional | Provide when building DBC claim (pool + feeVault pubkeys) |
| action | string | conditional | `claim` (current) – future: `withdraw`, `claim_and_withdraw` |
| simulateOnly | boolean | no | If true (default when DBC inputs present), returns simulated logs only |

Success response (fields subset):

```json
{
  "ok": true,
  "cuLimit": 600000,
  "microLamports": 250000,
  "computeBudgetIxs": [ { /* set CU limit */ }, { /* set price */ } ],
  "exitTxBase64": "...",   // present when DBC build succeeded
  "simulation": {"logs": [], "unitsConsumed": 5000}
}
```

Error example:

```json
{"ok": false, "error": "Missing claim discriminator: DBC_CLAIM_FEE_*"}
```

Mock mode (testing only): set `TEST_MOCK_RPC=mock` to inject deterministic blockhash + simulation; never enable in production.



