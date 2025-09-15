# /exit Page End-to-End Verification

Comprehensive checklist to ensure the DBC One-Click Exit flow is fully functional and
production‑ready.

## 1. Environment Preconditions

| Item              | Expectation                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| Wallet Connection | Able to connect Phantom / Solflare in mainnet (or devnet if configured)        |
| RPC Env Vars      | `NEXT_PUBLIC_RPC_URL` (client) matches server `RPC_URL` when overridden        |
| DBC Variables     | `DBC_PROGRAM_ID` and real `DBC_CLAIM_FEE_DISCRIMINATOR` set (avoid placeholder) |
| Studio Runtimes   | DBC (and optionally DAMM v2) runtime build present so decoding + builders work |

## 2. Discovery Layer

| Scenario             | Steps                                    | Expected                                   |
| -------------------- | ---------------------------------------- | ------------------------------------------ |
| LP Token Based Pool  | Wallet holds DBC LP tokens               | Pool appears with LP amount > 0            |
| NFT Runtime Position | Wallet has runtime NFT migration         | Pool appears tagged `[nft]` or `[decoded]` |
| Metadata Heuristic   | Wallet has NFT metadata referencing pool | Pool appears tagged appropriately          |
| No Positions         | Remove all LP/NFTs                       | Selector shows empty / disabled state      |

## 3. Single Pool Exit Flow

| Stage                   | Trigger                    | Expected State / UI                             |
| ----------------------- | -------------------------- | ----------------------------------------------- |
| Build                   | Click Exit Selected        | status = building; button disabled              |
| Simulation (if enabled) | simulateFirst=true         | Simulation logs section appears with logs count |
| Signing                 | After payload built        | status = signing                                |
| Sending                 | After signature            | status = sending; signature undefined yet       |
| Confirming              | sendTransaction returns    | status = confirming; signature displayed        |
| Success                 | Confirmation ok            | status = success; explorer link working         |
| Error                   | Network / validation fault | status = error; friendly message displayed      |
| Abort                   | Click Abort mid-process    | status = error; message = Aborted               |

## 4. Adaptive Priority Escalation

| Condition    | Action                                                    | Expected                                                      |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------- |
| Congestion   | Force transient failure (e.g. raise artificial RPC error) | currentPriorityMicros increases ~35% each retry (<=3,000,000) |
| Fast Success | Normal network                                            | No increase beyond initial priorityMicros                     |

## 5. Batch Exit (ALL)

Prototype auto batch (claim‑fee only) validation. Enable toggle on `/exit` page.

| Scenario                | Steps / Action                                             | Expected                                                                                     |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Toggle Persistence      | Enable → reload page                                       | Toggle remains enabled (localStorage)                                                        |
| Initial Run             | Click "Run Auto Batch Exit" with N positions               | Table appears with N rows status=pending                                                     |
| Sequential Progression  | Observe statuses                                           | Row i moves pending→signed→sent→confirmed before i+1 begins                                  |
| Explorer Links          | After confirmation                                         | Signature link opens Solana Explorer                                                         |
| Error Handling          | Force one tx fail (e.g., bad discriminator)                | Failed row shows status=error + truncated error message                                      |
| Abort Mid-Stream        | Click Abort Batch during row k sending/confirming          | Processing stops after current attempt; remaining rows stay pending                          |
| Completion Timing       | After final row confirmed                                  | Footer shows total seconds (approx wall time)                                                |
| Multiple Runs           | Run again after completion                                | Previous table persists; new run appends or replaces (current impl replaces state)           |

Limitation: Currently mode column = `claim` only (full liquidity withdrawal legs will be integrated once
official instruction + discriminator confirmed – placeholder discriminator will not succeed on-chain).

## 6. Preference Persistence

| Key              | Storage                     | Validation                          |
| ---------------- | --------------------------- | ----------------------------------- |
| priority         | localStorage dbc-exit-prefs | Reload page → value restored        |
| slippageBps      | localStorage dbc-exit-prefs | Reload page → value restored        |
| simulateFirst    | localStorage dbc-exit-prefs | Reload page → toggle consistent     |
| fastMode         | localStorage dbc-exit-prefs | Toggle on → reload → remains on     |
| computeUnitLimit | localStorage dbc-exit-prefs | Set value → reload → value restored |

## 7. Error Mapping Spot Check

| Raw Condition     | Simulated Cause                           | Friendly Output                                 |
| ----------------- | ----------------------------------------- | ----------------------------------------------- |
| Blockhash expired | Delay confirmation beyond validity        | Blockhash expired – network congestion, retried |
| Slippage          | Force slippage via unrealistic constraint | Slippage or output below minimum                |
| Insufficient SOL  | Use wallet with < fee requirement         | Insufficient SOL for fees                       |

## 8. API Smoke Test

Run (with env vars):

```bash
TEST_OWNER_PUBKEY=<pubkey> TEST_DBC_POOL_KEYS='{"pool":"...","feeVault":"..."}' \
pnpm --filter @meteora-invent/scaffold/fun-launch exec ts-node src/tests/dbcExitSmoke.ts
```

Expect: HTTP 200, fields: `simulated`, `logs[]`, `unitsConsumed`, `tx`.

## 9. Fast Mode Verification

| Scenario                   | Action                                          | Expected                                                                                           |
| -------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Enable Fast Mode (Single)  | Toggle Fast Mode on single exit panel           | Simulation toggle auto-disabled; CU limit optional field visible                                   |
| Processed Timing Capture   | Perform exit                                    | Timing grid shows Build/Sign/Send; Proc appears earlier than Conf (if processed confirm succeeded) |
| CU Limit Applied           | Set CU limit (e.g. 900000) then exit            | Transaction succeeds (inspect explorer CU consumption ~<= limit)                                   |
| Skip Simulation            | Fast Mode on with simulateFirst previously true | No simulation logs section rendered                                                                |
| Abort Fast Mode            | Start fast exit then click Abort quickly        | status=error, error=Aborted; no lingering confirming state                                         |
| Preference Persistence     | Enable fastMode + set CU limit then reload      | Both settings retained                                                                             |
| Fallback to Confirmed Only | Force processed confirm failure (rare)          | Proc column may remain '-' but Conf still populates                                                |

Safety Note: Fast Mode uses skipPreflight + processed-first confirmation. For critical value
withdrawals use normal mode with simulation.

## 10.1 DBC Builder Placeholder Warning

Until `DBC_CLAIM_FEE_DISCRIMINATOR` is populated with the production 8-byte discriminator the claim
instruction will be a placeholder and will fail on-chain. Replace the default env placeholder as
soon as the official value is confirmed from Meteora documentation / IDL.

## 10. Security / Safety Observations

| Aspect            | Current                                            | Notes                              |
| ----------------- | -------------------------------------------------- | ---------------------------------- |
| Input Validation  | Server enforces priorityMicros, slippageBps ranges | Extend if adding new args          |
| Abort Handling    | Hook abort sets state error=Aborted                | Could surface toast distinct style |
| Program Allowlist | Not enforced                                       | Optional enhancement               |

## 11. Recommended Fast-Follow (Optional)

1. Bounded concurrency (2–3) for batch to reduce wall time.
2. Output token preview pre-exit (quote / share calc).
3. More granular error decoding using on-chain program error tables.
4. Persist last successful signature list for batch session summary.

---

Updated automatically as part of exit verification hardening.

---

## 12. Universal Exit (DBC + DAMM v2) Verification

This section complements earlier checks by validating the new combined multi‑protocol flow.

### 12.1 Planning Phase

| Scenario | Steps | Expected |
| -------- | ----- | -------- |
| Mixed Positions | Wallet holds at least one DBC & one DAMM v2 position | Planner produces >=2 tasks (protocol set contains dbc & dammv2) |
| DBC Only | Remove DAMM v2 position(s) | Only dbc tasks created |
| DAMM v2 Only | Remove DBC positions | Only dammv2 tasks created |
| None | Empty wallet | Planner returns 0 tasks; no execution started |

### 12.2 Execution Sequencing

| Stage | Observation |
| ----- | ----------- |
| After Plan | Items list populated with status=pending |
| Signing | First item status→signed before any second item mutation |
| Send | signed→sent with transient absence of signature link until confirm |
| Confirm | sent→confirmed; signature link (explorer) works |
| Progression | Index increments strictly (no interleaving) |

### 12.3 Error Isolation

Induce failure (e.g., tamper with one tx base64 in dev tools before signing): row transitions to error while subsequent rows continue to process.

| Test | Steps | Expected |
| ---- | ----- | -------- |
| Single Failure | Modify one serialized tx to corrupt bytes | That row = error; others unaffected |
| Abort Midway | Click Abort after N confirmations | Remaining rows keep status=pending (not processed) |

### 12.4 DAMM v2 Withdraw Specific

| Scenario | Expected |
| -------- | -------- |
| Full Removal | Position after confirm shows 0 liquidity (RPC refresh) |
| Explorer CU | Transaction CU usage within reasonable bounds (no runaway) |

### 12.5 DBC Claim Coexistence

| Scenario | Expected |
| -------- | -------- |
| Mixed Batch | Both claim & withdraw signatures present in chronological order |
| Placeholder Discriminator (dev) | Claim tx may fail; withdraw continues |

### 12.6 Post-Run Summary (Manual)

Record: total tasks, successes, failures, abort flag, wall time (end-start). Future enhancement: automatic persisted JSON summary.

### 12.7 Safety Checks

| Check | Expectation |
| ----- | ----------- |
| Program IDs | All DBC transactions use configured `DBC_PROGRAM_ID` | 
| Priority Clamp | microLamports never exceed 3,000,000 |
| Serialization | No task with invalid base64 (planner would have thrown) |

### 12.8 Regression Guard Ideas

Automated integration test (future): mock fetch endpoints returning deterministic tx; assert sequential status transitions.

