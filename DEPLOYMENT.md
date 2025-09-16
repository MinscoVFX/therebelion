# Deployment Guide (Vercel)

This repository is a pnpm workspace monorepo. The only production Next.js frontend currently
intended for deployment lives at:

```
scaffolds/fun-launch
```

You have two supported deployment strategies. Pick ONE.

---

## 1. Preferred: Set Root Directory in Vercel (Simplest)

**When to choose**: You only need to deploy the fun-launch app; root-level API routes are not
required.

Steps:

1. In Vercel Project Settings → General → Root Directory: set to `scaffolds/fun-launch`.
2. Delete the root `vercel.json` file (or keep it out of git via .gitignore). Vercel will
   auto-detect Next.js.
3. Ensure environment variables (see matrix below) are defined for Production & Preview.
4. Trigger a redeploy (new commit or manual).

Pros:

- Auto-detected build (`next build`) – less custom config.
- Clear separation: only the app's code is considered.

Cons:

- Root-level `/pages/api/*` (if ever added) will not deploy unless moved under the scaffold.

---

## 2. Current: Keep Project Root and Use `vercel.json`

**When to choose**: You plan to add other packages at root later, or want explicit control.

Already configured in `vercel.json`:

```jsonc
{
  "framework": "nextjs",
  "buildCommand": "pnpm install --frozen-lockfile && pnpm --filter @meteora-invent/scaffold-fun-launch build",
  "outputDirectory": "scaffolds/fun-launch/.next",
}
```

Pros:

- Single repository root for config.
- Easy to extend with future build steps (e.g. codegen pre-step).

Cons:

- Slightly slower: installs all workspace deps (acceptable unless very large).
- Must manually keep `vercel.json` aligned if path or package name changes.

---

## Environment Variable Matrix

Variables you likely need (configure in Vercel → Project → Settings → Environment Variables):

| Variable                      | Required?                    | Scope        | Notes                                                                                                   |
| ----------------------------- | ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `RPC_URL`                     | Yes                          | Server       | Primary Solana RPC endpoint (private strongly recommended).                                            |
| `NEXT_PUBLIC_RPC_URL`         | One of (with RPC_URL)        | Client       | Public RPC if exposing to browser; omit if you proxy all requests server-side.                         |
| `ALLOWED_DBC_PROGRAM_IDS`     | Recommended (prod)           | Both         | JSON array string including official program IDs (see code).                                           |
| `ALLOWED_DAMM_V2_PROGRAM_IDS` | Recommended (prod)           | Both         | JSON array string including official DAMM v2 program IDs.                                              |
| `DBC_CLAIM_FEE_INSTRUCTION_NAME` | Optional                  | Server       | One of: `auto`, `claim_creator_trading_fee`, `claim_partner_trading_fee`, `claim_fee`.                  |
| `DBC_CLAIM_FEE_DISCRIMINATOR` | Optional (mutually exclusive)| Server       | 16 hex chars; overrides instruction name if provided and valid.                                        |
| `NEXT_PUBLIC_PUBLIC_BASE_URL` | Optional                     | Client       | If you need absolute canonical links; otherwise relative URLs are fine.                                |
| `R2_ACCESS_KEY_ID`            | Optional                     | Server       | Required only if enabling R2 uploads for token logos (future enhancement).                              |
| `R2_SECRET_ACCESS_KEY`        | Optional                     | Server       | R2 secret key.                                                                                          |
| `R2_ACCOUNT_ID`               | Optional                     | Server       | R2 account identifier.                                                                                 |
| `R2_BUCKET`                   | Optional                     | Server       | Bucket name.                                                                                            |
| `R2_PUBLIC_BASE`              | Optional                     | Both         | Public base URL for assets served from R2.                                                             |
| `NEXT_PUBLIC_ENABLE_DEV_PREBUY` | Optional (default true)    | Client       | If set to `false`, hides or disables the dev pre-buy (bundle) flow in create pool UI.                   |
| `NEXT_PUBLIC_ENABLE_VANITY`   | Optional (default true)      | Client       | If set to `false`, removes the vanity mint suffix generation UI.                                       |
| `NEXT_PUBLIC_LOG_LEVEL`       | Optional                     | Client       | `debug`/`info`/`warn` to tune console noise in production previews.                                    |
| `APP_URL`                     | Optional (deploy check)      | Server/CI    | Used by `vercel:health-check` script; falls back to `VERCEL_URL` if absent.                            |
| `COV_MIN_BRANCHES` etc.       | CI only                      | CI           | Coverage gates (see `scripts/coverage-threshold-check.mjs`).                                            |

### Minimal Production Set

At minimum set: `RPC_URL`, `ALLOWED_DBC_PROGRAM_IDS`, `ALLOWED_DAMM_V2_PROGRAM_IDS`.

Example values (JSON arrays as strings):

```
ALLOWED_DBC_PROGRAM_IDS=["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"]
ALLOWED_DAMM_V2_PROGRAM_IDS=["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"]
```

Notes:

- If both `RPC_URL` and `NEXT_PUBLIC_RPC_URL` are unset the `/api/health` endpoint returns
  `ok: false`.
- To add additional Solana cluster switching, you can introduce `NEXT_PUBLIC_SUPPORTED_CLUSTERS`
  later.

---

## Post-Deployment Health Check

After deployment obtain the production URL and verify:

```
GET https://<your-domain>/api/health
```

Expected JSON (example):

```json
{
  "ok": true,
  "rpc": { "cluster": "1.18.9" },
  "env": { "HAS_RPC_URL": true, "hasAllowedDbcList": true, "hasAllowedDammList": true }
}
```

If `ok: false`:

- Missing RPC env vars → add `RPC_URL`.
- Network issues → verify endpoint reachability / rate limits.

---

## Local Reproduction of Vercel Build

Strategy 1 (Root Directory):

```bash
cd scaffolds/fun-launch
pnpm install
pnpm build
```

Strategy 2 (Current Config):

```bash
pnpm install
pnpm --filter @meteora-invent/scaffold-fun-launch build
```

---

## Optional Optimizations

1. Use `pnpm fetch` + offline install (not usually necessary unless cold starts are slow):

```bash
pnpm fetch
pnpm install --offline --frozen-lockfile
```

2. Add a prebuild script for code generation if/when needed:
   `"prevercel-build": "node scripts/codegen.js"`.
3. Move any future API routes into the scaffold's `src/pages/api` folder for Strategy 1 simplicity.
4. Bundle size inspection: use `NEXT_PRIVATE_STATS=1` or `next build --profiling` locally.

---

## Migration Between Strategies

Switching from Strategy 2 → 1:

1. Remove `vercel.json`.
2. Set Root Directory in Vercel.
3. Redeploy.

Switching from Strategy 1 → 2:

1. Restore `vercel.json` (copy from git history).
2. Clear Root Directory setting (reset to repo root).
3. Redeploy.

---

## Failure Troubleshooting Guide

| Symptom                     | Likely Cause                                   | Fix                                                                                     |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Module not found` on build | Missing workspace install or wrong filter name | Verify package name matches `@meteora-invent/scaffold-fun-launch`.                      |
| 404 on `/` after deploy     | Wrong outputDirectory or wrong root strategy   | Confirm strategy; if using Strategy 2 ensure `outputDirectory` path exists in artifact. |
| Build timeout               | Cold cache + all workspaces building           | Consider Strategy 1 or prune unused packages.                                           |
| `ok: false` health          | RPC vars missing                               | Add `RPC_URL` or `NEXT_PUBLIC_RPC_URL`.                                                 |
| Rate-limited RPC            | Shared public RPC                              | Switch to a private provider (Helius, Triton, etc.).                                    |

---

## Next Potential Enhancements

- Add `/api/metrics` for runtime analytics / health trends.
- Introduce edge runtime for lightweight endpoints (move selective routes to
  `export const config = { runtime: 'edge' }`).
- Add Canary deployment using Preview + feature flags.

---

**End of Guide**

---

## Pool Launch Runbook (End-to-End)

This section details the operational steps for launching a new token pool using the UI.

### 1. Prerequisites

- Wallet with sufficient SOL for:
  - Creation fee (as enforced by backend logic / fee transfers)
  - Optional dev pre-buy amount
  - Network fees & (optional) Jito tip
- Environment variables set (see matrix above).
- (Optional) Vanity mint or dev pre-buy features enabled (not disabled by env flags).

### 2. Connect Wallet

Open the site, connect a supported Solana wallet. Verify `/api/health` returns `ok: true` (RPC reachable).

### 3. Prepare Token Metadata

Gather:
- Token name (>= 3 chars)
- Symbol
- 1:1 square logo (PNG recommended) – file is base64 uploaded via `/api/upload`.
- Optional website & twitter links.

### 4. (Optional) Vanity Mint Suffix

If enabled, enter up to 4 Base58 chars. The client will search for up to 30 seconds. If timeout occurs, a normal mint is generated.

### 5. Submit Create Form

The UI will:
1. Convert logo to base64.
2. POST to `/api/upload` (builds initial create transaction & stores metadata).
3. Decode & partially sign (vanity mint keypair if included).
4. Wallet signs.

### 6. (Optional) Dev Pre-Buy Bundle

If dev pre-buy enabled and amount > 0, the client:
1. Calls `/api/build-swap` with the create transaction's blockhash (prelaunch mode).
2. Receives a placeholder swap transaction (currently a no-op transfer; replace with real route logic as needed).
3. Optionally appends a Jito tip transfer if `/api/jito-bundle` returns accounts.
4. Signs & bundles both transactions through `/api/send-transaction` with `waitForLanded=true`.

### 7. Single TX Path

If no dev pre-buy, only the create transaction is sent to `/api/send-transaction`.

### 8. Confirmation & UI State

Success toast shown; UI sets `poolCreated=true`. Add any post-creation navigation (future enhancement: redirect to pool detail page).

### 9. Post-Launch Verification

- Check Solana explorer for the creation signature.
- Inspect token metadata correctness.
- (If real swap logic implemented) Validate initial liquidity / price curve via pool explorer.

### 10. Rollback Strategy

If a launch fails mid-bundle:
- The mint might exist without liquidity; you can relaunch using same UI if state is still consistent or discard and generate a new vanity.
- If a partial transaction consumed fees, review logs via explorer for root cause (RPC rate limit, priority fee insufficient, etc.).

---

## Hardening Checklist (Pre-Mainnet Launch)

- [ ] Replace placeholder `/api/build-swap` logic with actual route planning (DEX / bonding curve).
- [ ] Add server-side validation for uploaded logo size & MIME type.
- [ ] Add rate limiting (e.g., per-IP) to create & upload endpoints.
- [ ] Introduce feature flags to disable vanity and dev pre-buy in production if not desired.
- [ ] Expand integration tests for create + bundle path (currently partially covered by unit tests only).
- [ ] Implement better error surfaces (map common RPC errors to user-friendly messages).

---

## Environment Variable Quick Reference Table

| Category    | Vars                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Core RPC    | `RPC_URL`, `NEXT_PUBLIC_RPC_URL`                                                                 |
| Program IDs | `ALLOWED_DBC_PROGRAM_IDS`, `ALLOWED_DAMM_V2_PROGRAM_IDS`                                         |
| DBC Fees    | `DBC_CLAIM_FEE_INSTRUCTION_NAME`, `DBC_CLAIM_FEE_DISCRIMINATOR`                                   |
| Features    | `NEXT_PUBLIC_ENABLE_DEV_PREBUY`, `NEXT_PUBLIC_ENABLE_VANITY`                                     |
| Assets/R2   | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_BASE`       |
| Misc        | `NEXT_PUBLIC_PUBLIC_BASE_URL`, `NEXT_PUBLIC_LOG_LEVEL`, `APP_URL`                                |

