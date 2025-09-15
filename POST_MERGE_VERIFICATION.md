## Post-Merge & Post-Deploy Verification Guide

This checklist validates that the mainnet claim-only DBC exit path is correctly deployed, safe, and observable.

Run these steps after merging `fix/mainnet-exit-prod` into `main` and deploying to Vercel.

---
### 1. Environment Variables
Confirm the production deployment has (at minimum):

Required:
- `RPC_ENDPOINT` (or `RPC_URL`) and `NEXT_PUBLIC_RPC_URL` (can point to same endpoint)
- `POOL_CONFIG_KEY` (if required by exit planning code)

Discriminator Inputs (choose ONE primary source):
- `DBC_CLAIM_FEE_DISCRIMINATOR` (8-byte hex, e.g. `a1b2c3d4e5f60708`) OR
- `DBC_CLAIM_FEE_INSTRUCTION_NAME` (Anchor instruction name, e.g. `claimFee`) OR
- `DBC_USE_IDL=1` with a valid `dbc_idl.json` deployed at the project root containing an instruction that matches the claim instruction.

Hardening:
- `ALLOW_PLACEHOLDER_DBC` MUST be unset (or set to `0`) in production.

---
### 2. Health Endpoint
Check the health route for status and discriminator provenance.

```bash
curl -s https://<your-vercel-domain>/api/health | jq
```

Expect JSON keys (example):
```json
{
  "ok": true,
  "env": { "RPC_ENDPOINT": true, "NEXT_PUBLIC_RPC_URL": true, ... },
  "dbc": {
    "claim": { "source": "env-hex" | "env-name" | "idl" },
    "placeholder": false
  }
}
```

Failure modes:
- If `placeholder` is `true` in production => BLOCKER, fix env/discriminator immediately.
- If `ok` is `false`, inspect missing env flags.

---
### 3. Simulate-Only Exit (No Broadcast)
```bash
curl -s "https://<domain>/api/dbc-exit?action=claim&simulateOnly=1" | jq
```
Expect:
```json
{
  "txBase64": "...",
  "simulateLogs": ["Program ..."],
  "discriminatorSource": "env-hex"
}
```

Validate:
- `txBase64` decodes to a VersionedTransaction (length > ~100 bytes typical)
- `discriminatorSource` matches health route
- `simulateLogs` present (may be empty array if program silent)

---
### 4. Live Transaction Path
Sign & POST (front-end normally does this). Manual test using a funded test wallet (not production treasury) is optional. Ensure the endpoint DOES NOT accept legacy `Transaction` objects.

---
### 5. Withdraw Disabled Guard
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://<domain>/api/dbc-exit?action=withdraw"
```
Expect HTTP `501`.
```bash
curl -s "https://<domain>/api/dbc-exit?action=withdraw" | jq
```
Expect JSON with error message referencing withdraw being disabled.

---
### 6. Placeholder Guard (Negative Test - Staging Only)
In a staging environment ONLY, unset discriminator env vars and disable IDL. Call:
```bash
curl -s "https://<staging-domain>/api/dbc-exit?action=claim&simulateOnly=1" | jq
```
Expect HTTP 500 with message about unresolved discriminator (proves production safety).

---
### 7. CI Status
Ensure the GitHub Actions workflow (typecheck, lint, build) passed on the merge commit. All green before promoting.

---
### 8. Observability & Logging
Review Vercel function logs for `/api/dbc-exit` calls:
- Confirm no warnings about placeholder
- Confirm discriminator source logged (if logging enabled in code or added externally)

---
### 9. Regression Spot Checks
Front-end `/exit` page:
- Withdraw UI absent
- Action fixed to claim
- Flow builds transaction quickly and surfaces any simulation errors.

---
### 10. Risk Matrix Quick Scan
| Vector | Mitigation |
|--------|------------|
| Wrong discriminator | Strict resolution order; production blocks placeholder. |
| Silent placeholder | Health endpoint exposes `placeholder: false`. |
| Legacy TX path misuse | Send endpoint enforces VersionedTransaction only. |
| Withdraw misuse | 501 guard + UI removed. |
| Env drift | Health route enumerates presence; CI builds fail if critical imports break. |

---
### 11. Completion Criteria
You are DONE when:
- Health shows correct discriminator source (`env-hex`, `env-name`, or `idl`)
- Placeholder false
- Simulate-only path returns valid base64 transaction
- Withdraw path blocked (501)
- CI green
- No unexpected warnings in logs pertaining to DBC exit

---
### 12. Optional Future Enhancements
- Add synthetic monitoring hitting simulate endpoint hourly.
- Add version hash / git SHA to health output.
- Add structured logging for discriminator source on each request.

---
Document version: 1.0 (aligns with PR: mainnet-ready DBC claim exit hardening).
