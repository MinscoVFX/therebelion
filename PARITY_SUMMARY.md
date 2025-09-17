# Meteora DBC Exit Parity Summary

This document captures the current implementation status of the one‑click (and batch) DBC exit flow
in this repository and how it aligns with Meteora tooling expectations.

## Achieved Capabilities

| Area                                                 | Status           | Notes                                                                                            |
| ---------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| Transaction assembly (claim + optional DAMM remove)  | ✅               | Ordered: compute budget -> DBC claim -> optional DAMM v2 remove liquidity.                       |
| Input validation (API)                               | ✅               | priorityMicros, slippageBps, lpPercent range enforced; missing args explicit 4xx errors.         |
| Retry & resilience                                   | ✅               | Hook retries with jitter; adaptive priority escalation per attempt.                              |
| Simulation preflight                                 | ✅               | `simulateOnly=true` returns logs, err, units before user signs.                                  |
| Fast Mode (skip preflight + processed-first confirm) | ✅               | UI toggle: skips simulation, sends with `skipPreflight`, displays processed + confirmed timings. |
| Timing instrumentation                               | ✅               | Hooks capture build/sign/send/processed/confirmed + total for perf diagnostics.                  |
| Optional compute unit limit                          | ✅               | User can specify CU limit (50k–1.4M) injected via ComputeBudget ix.                              |
| Pool discovery (LP)                                  | ✅               | Parsed token account scan; aggregates LP amounts; sorts by size.                                 |
| Pool discovery (NFT runtime)                         | ✅               | Uses DAMM v2 runtime position NFT enumeration where available.                                   |
| Pool discovery (NFT metadata heuristic)              | ✅               | Falls back to Metaplex metadata scan (singleton NFTs).                                           |
| Pool decoding                                        | ✅ (best effort) | Attempts runtime decode for base/quote mints + fee vault; graceful fallback.                     |
| Source differentiation                               | ✅               | Selector badges: `[decoded]`, `[nft]`, `[demo/discovered]`.                                      |
| Structured error decoding                            | ✅ (light)       | Common patterns mapped (slippage, blockhash expired, insufficient funds, etc.).                  |
| Adaptive priority fee                                | ✅               | 35% escalation per retry (capped at 3M microLamports).                                           |
| Abort handling                                       | ✅               | Hook supports abort on unmount or manual call.                                                   |
| Type safety                                          | ✅               | Added builder arg interfaces and narrowed dynamic calls.                                         |
| Documentation                                        | ✅               | This summary plus inline comments.                                                               |

## Remaining Optional Enhancements

1. Accurate token symbol & decimals enrichment (optionally query token metadata program or a symbol
   registry).
2. Pool valuation (fetch reserves & derive USD/quote value for displayed LP share).
3. Local/IndexedDB cache of decoded pools & NFT scan (reduce RPC load on reconnect).
4. More granular program error mapping (decode custom error codes if IDL available).
5. Parallel (bounded) batch exits with concurrency & abort UI (current implementation is sequential
   for determinism & lower contention).
6. UI preview of expected token out amounts pre-exit (simulate withdraw quote for DAMM or compute
   share of reserves for DBC).
7. Security hardening: optional allowlist of known program IDs & pool addresses.
8. Persist user preferences (priority, simulate toggle, slippage) in local storage.

## /exit Page Workflow

The `/exit` page now provides two coordinated panels powered by the unified discovery + exit hook
stack:

1. Pool Selector: Aggregates LP + runtime NFT + metadata heuristic sourced pools. Selecting `ALL`
   enables batch mode.
2. Single Pool Exit Panel:
   - Inputs: `priorityMicros`, `slippageBps`, `simulateFirst`, `fastMode`, optional
     `computeUnitLimit`.
   - Displays: live status (`building|signing|sending|confirming`), escalated priority, simulation
     logs (if run), timing grid (Build/Sign/Send/Proc/Conf/Total), signature, errors, reset.
3. Batch Exit Panel (ALL):
   - Sequentially exits every discovered pool (DBC claim → optional DAMM; currently DBC only)
     honoring the same inputs.
   - Shows per-pool row with status (`pending|success|error`) & explorer link on success.
   - Chosen sequentially to reduce RPC spikes & simplify adaptive fee logic; can be upgraded to
     bounded concurrency later.
4. Adaptive Priority: Escalation belongs to each attempt inside the hook; batch runs independently
   reuse initial value per pool (fresh attempts) for fairness.
5. Simulation: If enabled, only performed on the first attempt of each pool before building the real
   transaction.

### Hook Contract (Quick Reference)

Input fields (selected subset):

- `dbcPoolKeys`: `{ pool: string; feeVault: string }` (required)
- `priorityMicros`: initial microLamports per compute unit (adaptive escalation applied internally)
- `simulateFirst`: boolean; perform one preflight simulation and capture logs (disabled
  automatically if `fastMode` true)
- `fastMode`: boolean; skip simulation + preflight; attempt processed-first confirmation, then
  confirmed
- `computeUnitLimit`: optional number; adds compute budget limit instruction
- `slippageBps`: forwarded to API (affects DAMM v2 leg when enabled)

State fields:

- `status`: lifecycle stage
- `attempt`: current attempt index (1-based)
- `currentPriorityMicros`: escalated fee value
- `simulation`: `{ logs[], unitsConsumed }` if preflight run
- `signature`: transaction signature after send
- `timings`: `{ started, built?, signed?, sent?, processed?, confirmed? }` for performance insight
- `error`: friendly decoded error message

### Error Semantics

Common decoded messages include: `Blockhash expired`, `Insufficient SOL for fees`,
`Slippage or output below minimum`, and generic fallback for unrecognized errors. Escalation occurs
automatically unless max attempts reached.

### Batch Behavior

Each pool executes fully (retries + escalation + optional simulation) before moving to the next.
Errors are recorded but do not halt remaining pools.

### Fast Mode Notes

Fast Mode is intended for time-sensitive exits where simulation is optional and rapid inclusion is
prioritized:

- Uses `skipPreflight` send option and processed-first confirmation path.
- Still performs a full confirmed confirmation after (processed) to ensure finality.
- Simulation logs are omitted; rely on prior simulations or conservative slippage for safety.
- Recommended only when confident in pool parameters and slippage boundaries.

### Extensibility Notes

To layer in DAMM v2 removal alongside the DBC claim for each pool within batch mode, pass
`includeDammV2Exit` plus resolved `dammV2PoolKeys` from discovery, then surface additional
program-specific status in the per-pool table. Current batch panel intentionally omits this until
DAMM runtime stability is confirmed for all environments.

## Usage Notes

Simulation: set `simulateFirst` in hook options OR call API with `simulateOnly=true` to inspect logs
before signing.

Priority Escalation: Initial `priorityMicros` is increased automatically on each retry (capped) —
keep the first value modest; hook scales when congestion occurs.

NFT Discovery: Metadata heuristic may surface false positives if unrelated NFTs embed base58 strings
of correct length; decoder pass will discard non-existent pool accounts. Consider adding a secondary
on-chain validation pass if false positives become an issue.

Pool Decoding: Best-effort; if runtime build shape changes and `DynamicBondingCurveClient` isn’t
resolvable, the scanner silently falls back to placeholder fee vault & duplicate base/quote mints.

## Quick Integration Checklist

1. Wrap app with `DbcPoolProvider` and `ToastProvider`.
2. Use `DbcPoolSelector` for pool choice (supports All if multiple discovered).
3. Call `useDbcInstantExit().exit({ dbcPoolKeys, priorityMicros, simulateFirst: true })` for a safe
   exit.
4. Inspect returned `state.signature` for explorer link on success.

## Acceptance Criteria Met

- End-to-end exit flow functions under: LP only, NFT only, combined cases.
- Resilient against expired blockhash and light RPC instability.
- Clear error reporting and structured messages for common failure causes.
- Doesn’t crash when runtime absent—feature degrades gracefully.

---

Generated automatically; keep this file updated if extending parity.
