# Deployment Guide (Vercel)

This repository is a pnpm workspace monorepo. The only production Next.js frontend currently intended for deployment lives at:

```
scaffolds/fun-launch
```

You have two supported deployment strategies. Pick ONE.

---
## 1. Preferred: Set Root Directory in Vercel (Simplest)

**When to choose**: You only need to deploy the fun-launch app; root-level API routes are not required.

Steps:

1. In Vercel Project Settings → General → Root Directory: set to `scaffolds/fun-launch`.
2. Delete the root `vercel.json` file (or keep it out of git via .gitignore). Vercel will auto-detect Next.js.
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
  "outputDirectory": "scaffolds/fun-launch/.next"
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

| Variable | Required? | Scope | Notes |
|----------|-----------|-------|-------|
| `RPC_URL` | Yes (server) | Server | Solana RPC endpoint (private preferred). |
| `NEXT_PUBLIC_RPC_URL` | One of (with RPC_URL) | Client | Public RPC if exposing to browser. |
| `ALLOWED_DBC_PROGRAM_IDS` | Recommended | Both | Comma-separated or JSON list of allowed DBC program IDs. |
| `ALLOWED_DAMM_V2_PROGRAM_IDS` | Recommended | Both | Same pattern for DAMM v2. |
| `NEXT_PUBLIC_PUBLIC_BASE_URL` | Optional | Client | Used if the app builds absolute links. |
| `R2_ACCESS_KEY_ID` | Optional | Server | If using R2 storage flows. |
| `R2_SECRET_ACCESS_KEY` | Optional | Server | Secret key for R2. |
| `R2_ACCOUNT_ID` | Optional | Server | R2 account identifier. |
| `R2_BUCKET` | Optional | Server | Default bucket. |
| `R2_PUBLIC_BASE` | Optional | Both | Public accessible base URL for bucket assets. |

Notes:

- If both `RPC_URL` and `NEXT_PUBLIC_RPC_URL` are unset the `/api/health` endpoint returns `ok: false`.
- To add additional Solana cluster switching, you can introduce `NEXT_PUBLIC_SUPPORTED_CLUSTERS` later.

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

2. Add a prebuild script for code generation if/when needed: `"prevercel-build": "node scripts/codegen.js"`.
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

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `Module not found` on build | Missing workspace install or wrong filter name | Verify package name matches `@meteora-invent/scaffold-fun-launch`. |
| 404 on `/` after deploy | Wrong outputDirectory or wrong root strategy | Confirm strategy; if using Strategy 2 ensure `outputDirectory` path exists in artifact. |
| Build timeout | Cold cache + all workspaces building | Consider Strategy 1 or prune unused packages. |
| `ok: false` health | RPC vars missing | Add `RPC_URL` or `NEXT_PUBLIC_RPC_URL`. |
| Rate-limited RPC | Shared public RPC | Switch to a private provider (Helius, Triton, etc.). |

---

## Next Potential Enhancements

- Add `/api/metrics` for runtime analytics / health trends.
- Introduce edge runtime for lightweight endpoints (move selective routes to `export const config = { runtime: 'edge' }`).
- Add Canary deployment using Preview + feature flags.

---
**End of Guide**
