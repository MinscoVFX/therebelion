## DBC Withdraw Liquidity Integration Requirements

This document enumerates the concrete pieces still required to safely implement the `withdraw` path
for DBC liquidity (currently a guarded placeholder in `dbc-exit-builder.ts`). It is intended as a
handoff checklist so the feature can be enabled with zero guesswork once authoritative data is
available.

### 1. Instruction Discriminator

Provide the exact 8‑byte discriminator (little‑endian hex) for the DBC withdraw / remove liquidity
instruction. If Anchor based, it is derived from:

```
sha256("global::<instruction_name>").slice(0, 8)
```

Required:

- Official instruction name: (e.g. `withdraw_liquidity`, `remove_liquidity`, etc.)
- Hex discriminator (first 16 hex chars of the hash) confirmed from IDL / on-chain.

Env variable (planned): `DBC_WITHDRAW_LIQUIDITY_DISCRIMINATOR`

### 2. Accounts Layout (Order + Mutability + Signers)

List ordered accounts exactly as invoked on-chain. For each: name, public key role, isWritable,
isSigner. Example schema:

| Index | Name              | Writable | Signer | Description                           |
| ----- | ----------------- | -------- | ------ | ------------------------------------- |
| 0     | pool              | true     | false  | Pool state PDA                        |
| 1     | position          | true     | false  | LP token account or position NFT data |
| 2     | owner             | false    | true   | User initiating withdrawal            |
| 3     | token_a_vault     | true     | false  | Vault A                               |
| 4     | token_b_vault     | true     | false  | Vault B                               |
| 5     | user_token_a_ata  | true     | false  | Destination token A                   |
| 6     | user_token_b_ata  | true     | false  | Destination token B                   |
| 7     | fee_vault         | false    | false  | (If required for fee settlement)      |
| 8     | token_program     | false    | false  | SPL Token program                     |
| 9     | system_program    | false    | false  | System program (if needed)            |
| ...   | additional_oracle | ?        | ?      | Oracles / config / authority PDAs     |

Adjust indices / presence to authoritative spec. Provide any seeds for PDA derivations if they are
not already in code.

### 3. Data Payload Schema

Provide binary layout for instruction data (after discriminator). For example:

| Offset | Type   | Name         | Notes                          |
| ------ | ------ | ------------ | ------------------------------ |
| 0      | u64 LE | lp_amount    | Amount of LP to burn/remove    |
| 8      | u16 LE | slippage_bps | (If enforced)                  |
| 10     | u8     | flags        | Bit flags (e.g. unwrap, close) |

If dynamic / vector fields exist, specify lengths and ordering. If no additional data (discriminator
only), explicitly state so.

### 4. Slippage / Safety Parameters

Clarify whether withdraw requires min output amounts or slippage tolerance. If so:

- Are token A + token B minimums passed as u64 values in the payload? (Order?)
- Are they optional (e.g. zero = no constraint)?
- Required default / recommendation.

### 5. Position Representation

Specify whether the position is represented by:

1. An SPL LP token account (classic AMM style) – then we burn LP vs pool.
2. A position NFT (metaplex metadata) – then provide PDA for position data & mint authoritative
   location.
3. Hybrid (LP + metadata) – outline both.

Include any necessary metadata or associated accounts (e.g. metadata account, edition account, etc.)
if required by the program.

### 6. Additional Authorities / Oracles

List any required authority PDAs (e.g. protocol signer, config, admin, oracle price feed) and how
they are derived. Provide seeds and program IDs for each.

### 7. Compute & Priority Guidance

Estimated compute unit usage range for typical withdrawal so we can set a sane default
`computeUnitLimit`. Also note if CU scales with number of ticks / ranges / complexity.

### 8. Event / Log Confirmation (Optional)

If the program emits a log line we can pattern-match to confirm success before full confirmation,
provide the canonical substring (e.g. `"WithdrawSuccess"`). This enables earlier UX updates.

### 9. SDK Builder (If Available)

If an official JS/TS SDK exposes a builder (e.g. `buildWithdrawTx`), specify:

- Package name & version
- Function signature
- Parameters mapping to the above schema

If present, we will prefer calling the SDK builder instead of manual discriminator/data assembly.

### 10. Security / Guardrails

Indicate any constraints we must enforce client-side (e.g. must withdraw full position, or min LP
amount). Note if partial withdraw is allowed and how to express percentage vs absolute.

### 11. Migration / Backwards Compatibility

If multiple program IDs coexist (migration period), clarify which IDs support withdraw and whether
account order/discriminator differs per version. Provide mapping if necessary.

---

### Implementation Plan (Once Data Supplied)

1. Add `DBC_WITHDRAW_LIQUIDITY_DISCRIMINATOR` env & loader.
2. Extend `buildDbcExitTransaction` switch for `action==='withdraw'` to build:
   - Create missing ATAs (token A/B) via `createAssociatedTokenAccountIdempotentInstruction`.
   - Add optional compute budget ix (reuse existing logic).
   - Insert withdraw ix using provided accounts & data encoding.
3. Update `/api/dbc-exit` to allow `action=withdraw` (remove placeholder error path).
4. Enable UI option (remove disabled attribute) in `/exit` page.
5. Add tests:
   - Discriminator resolution & env guard.
   - Withdraw transaction simulation (mock connection) verifying account order & data length.
   - Planner integration (universal + batch) including a withdraw task.
6. Update `EXIT_VERIFICATION.md` with withdraw checklist.

### Status

As of now (see git history for timestamp), withdraw remains intentionally unimplemented to avoid
ship risk. This document is the sole source of truth for what remains.

---

Please populate the sections above with official program details and commit. Once filled, the code
changes can be implemented in <1 hour including tests.
