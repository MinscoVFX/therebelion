# /exit Page End-to-End Verification

Comprehensive checklist to ensure the DBC One-Click Exit flow is fully functional and production‑ready.

## 1. Environment Preconditions
| Item | Expectation |
|------|-------------|
| Wallet Connection | Able to connect Phantom / Solflare in mainnet (or devnet if configured) |
| RPC Env Vars | `NEXT_PUBLIC_RPC_URL` (client) matches server `RPC_URL` when overridden |
| Studio Runtimes | DBC (and optionally DAMM v2) runtime build present so decoding + builders work |

## 2. Discovery Layer
| Scenario | Steps | Expected |
|----------|-------|----------|
| LP Token Based Pool | Wallet holds DBC LP tokens | Pool appears with LP amount > 0 |
| NFT Runtime Position | Wallet has runtime NFT migration | Pool appears tagged `[nft]` or `[decoded]` |
| Metadata Heuristic | Wallet has NFT metadata referencing pool | Pool appears tagged appropriately |
| No Positions | Remove all LP/NFTs | Selector shows empty / disabled state |

## 3. Single Pool Exit Flow
| Stage | Trigger | Expected State / UI |
|-------|---------|---------------------|
| Build | Click Exit Selected | status = building; button disabled |
| Simulation (if enabled) | simulateFirst=true | Simulation logs section appears with logs count |
| Signing | After payload built | status = signing |
| Sending | After signature | status = sending; signature undefined yet |
| Confirming | sendTransaction returns | status = confirming; signature displayed |
| Success | Confirmation ok | status = success; explorer link working |
| Error | Network / validation fault | status = error; friendly message displayed |
| Abort | Click Abort mid-process | status = error; message = Aborted |

## 4. Adaptive Priority Escalation
| Condition | Action | Expected |
|-----------|--------|----------|
| Congestion | Force transient failure (e.g. raise artificial RPC error) | currentPriorityMicros increases ~35% each retry (<=3,000,000) |
| Fast Success | Normal network | No increase beyond initial priorityMicros |

## 5. Batch Exit (ALL)
| Scenario | Expected |
|----------|----------|
| Sequential Processing | Each pool processed fully before next starts |
| Per-Pool Status | Table rows update from pending → success/error |
| Abort Batch | Abort button stops next pool processing; current attempt aborts with error=Aborted |
| Retry Logic | Individual pool failures escalate priority without affecting others |

## 6. Preference Persistence
| Key | Storage | Validation |
|-----|---------|------------|
| priority | localStorage dbc-exit-prefs | Reload page → value restored |
| slippageBps | localStorage dbc-exit-prefs | Reload page → value restored |
| simulateFirst | localStorage dbc-exit-prefs | Reload page → toggle consistent |
| fastMode | localStorage dbc-exit-prefs | Toggle on → reload → remains on |
| computeUnitLimit | localStorage dbc-exit-prefs | Set value → reload → value restored |

## 7. Error Mapping Spot Check
| Raw Condition | Simulated Cause | Friendly Output |
|---------------|-----------------|----------------|
| Blockhash expired | Delay confirmation beyond validity | Blockhash expired – network congestion, retried |
| Slippage | Force slippage via unrealistic constraint | Slippage or output below minimum |
| Insufficient SOL | Use wallet with < fee requirement | Insufficient SOL for fees |

## 8. API Smoke Test
Run (with env vars):
```bash
TEST_OWNER_PUBKEY=<pubkey> TEST_DBC_POOL_KEYS='{"pool":"...","feeVault":"..."}' \
pnpm --filter @meteora-invent/scaffold/fun-launch exec ts-node src/tests/dbcExitSmoke.ts
```
Expect: HTTP 200, fields: `simulated`, `logs[]`, `unitsConsumed`, `tx`.

## 9. Fast Mode Verification
| Scenario | Action | Expected |
|----------|--------|----------|
| Enable Fast Mode (Single) | Toggle Fast Mode on single exit panel | Simulation toggle auto-disabled; CU limit optional field visible |
| Processed Timing Capture | Perform exit | Timing grid shows Build/Sign/Send; Proc appears earlier than Conf (if processed confirm succeeded) |
| CU Limit Applied | Set CU limit (e.g. 900000) then exit | Transaction succeeds (inspect explorer CU consumption ~<= limit) |
| Skip Simulation | Fast Mode on with simulateFirst previously true | No simulation logs section rendered |
| Abort Fast Mode | Start fast exit then click Abort quickly | status=error, error=Aborted; no lingering confirming state |
| Preference Persistence | Enable fastMode + set CU limit then reload | Both settings retained |
| Fallback to Confirmed Only | Force processed confirm failure (rare) | Proc column may remain '-' but Conf still populates |

Safety Note: Fast Mode uses skipPreflight + processed-first confirmation. For critical value withdrawals use normal mode with simulation.

## 10. Security / Safety Observations
| Aspect | Current | Notes |
|--------|---------|-------|
| Input Validation | Server enforces priorityMicros, slippageBps ranges | Extend if adding new args |
| Abort Handling | Hook abort sets state error=Aborted | Could surface toast distinct style |
| Program Allowlist | Not enforced | Optional enhancement |

## 11. Recommended Fast-Follow (Optional)
1. Bounded concurrency (2–3) for batch to reduce wall time.
2. Output token preview pre-exit (quote / share calc).
3. More granular error decoding using on-chain program error tables.
4. Persist last successful signature list for batch session summary.

---
Updated automatically as part of exit verification hardening.