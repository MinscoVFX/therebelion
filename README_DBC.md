# Meteora DBC Launchpad Runbook

This document explains how to build, configure, and operate the Dynamic Bonding Curve (DBC) + DAMM
v2 launch / exit utilities inside this monorepo.

## 1. Studio Runtime (DBC + DAMM v2)

Centralized dynamic loading is done via `scaffolds/fun-launch/src/server/studioRuntime.ts`:

Priority order for each runtime:

1. `@meteora-invent/studio/lib/<module>` (preferred resolved package export)
2. Legacy dist fallback: `@meteora-invent/studio/dist/lib/<module>/index.js`
3. Workspace dist path: `../../studio/dist/lib/<module>/index.js`
4. Source fallback (dev only): `../../studio/src/lib/<module>/index.ts`

Adapters now call `getDbcRuntime()` / `getDammV2Runtime()` first, then (only if null) attempt legacy
candidates. This reduces bundle warnings and ensures a single caching layer.

To ensure availability:

```bash
pnpm --filter @meteora-invent/studio build
```

You can inspect runtime health via the Next.js health endpoint (scaffold):

GET `/api/health` → `{ ok: true, runtime: { damm_v2: boolean, dbc: boolean } }`

## 2. Environment Variables

Core env validation lives in `src/env/required.ts`. Provide (for CI/local):

```
RPC_URL=https://your.rpc
ALLOWED_DBC_PROGRAM_IDS=["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN","cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"]
ALLOWED_DBC_INSTRUCTIONS=["claim_trading_fee","withdraw","claim_and_withdraw"]
```

Additional optional configuration (examples):

```
DBC_DEFAULT_PRIORITY_MICROS=250000
DBC_MAX_RETRIES=3
```

## 3. Exit & Claim Flow (High Level)

1. Discover pools (scan or provided list) → `scanDbcPositionsUltraSafe`.
2. Build exit / claim instruction(s) via `buildBulletproofDbcExitIx` or claim builder.
3. Wrap with compute budget Ixs (priority fee + optional CU limit) if requested.
4. Simulate (optional) → escalate priority on failure.
5. Sign & send with retry/backoff (up to max attempts).

## 4. Testing Strategy

Two layers:

1. Unit / logic: Adapters accept an injected `runtimeModule` for deterministic tests.
2. Hook layer: `useDbcInstantExit` uses the `/api/dbc-exit` endpoint; we mock fetch + wallet
   adapter.

Run tests:

```bash
pnpm test:run
```

Generate coverage & enforce thresholds:

```bash
pnpm coverage
node scripts/coverage-threshold-check.mjs
```

## 5. Operational Scripts & CI

Workflows use a composite action to ensure `pnpm` presence, then run lint / typecheck / tests.
Coverage floors ratchet upwards over time. See `scripts/coverage-threshold-check.mjs` for logic. The
ratchet mode (`COV_RATCHET=1`) prevents regressions below the stored `.coverage-baseline.json`
(allowing a tiny tolerance) while still permitting higher coverage to automatically update the
baseline on pushes to `main`.

## 6. Troubleshooting

| Symptom                                            | Action                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Health endpoint shows `dbc: false`                 | Build studio package (`pnpm --filter @meteora-invent/studio build`).         |
| Dynamic import error `Studio DBC module not found` | Confirm workspace dependency + build output exists.                          |
| Low coverage gate failure                          | Adjust thresholds temporarily via env vars; improve tests then raise floors. |
| Priority fee not applied                           | Ensure `priorityMicros` passed (defaults to 250k).                           |

## 7. Future Enhancements (Backlog)

- (Done) Consolidate DAMM + DBC runtime loaders (central `studioRuntime.ts` + adapter fallback).
- Add on-chain slot latency tracking + adaptive priority escalation.
- Add integration harness hitting devnet ephemeral pools.
- Implement `.coverage-baseline.json` ratchet file for automatic upward drift.

---

Maintainers: Update this runbook whenever adapter or env contract changes.
