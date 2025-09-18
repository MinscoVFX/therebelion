# Fun Launch

A platform for launching tokens with customizable price curves.

## Setup

1. Clone the repository

```bash
git clone https://github.com/MeteoraAg/meteora-invent.git
cd scaffolds/fun-launch
```

2. Install dependencies

```bash
pnpm install
```

3. Set up environment variables Create a `.env` file in the root directory with the following
   variables:

```bash
cp .env.example .env
```

```env
# Cloudflare R2 Storage
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_ACCOUNT_ID=your_r2_account_id
R2_BUCKET=your_r2_bucket_name

# Solana RPC URL
RPC_URL=your_rpc_url

# Pool Configuration
POOL_CONFIG_KEY=your_pool_config_key
```

### Getting R2 Credentials

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to R2
3. Create a new bucket or select an existing one
4. Go to "Manage R2 API Tokens"
5. Create a new API token with the following permissions:
   - Account R2 Storage: Edit
   - Bucket: Your bucket name
6. Copy the Access Key ID and Secret Access Key
7. Your Account ID can be found in the Cloudflare dashboard URL or in the Account Home page

### Getting RPC URL

1. Get your RPC URL from any of 3rd party providers

### Pool Config Key

The pool config key is used to configure the bonding curve parameters. You'll need to:

1. Deploy your own pool config program
2. Or use an existing pool config program
3. Get the public key of the pool config account

4. Run the development server

```bash
pnpm dev
```

## Deployment

### Deploying to Vercel

1. Push your code to a GitHub repository

2. Go to [Vercel](https://vercel.com) and sign in with your GitHub account

3. Click "New Project"

4. Import your GitHub repository

5. Configure your project:
   - Framework Preset: Next.js
   - Root Directory: ./
   - Build Command: `pnpm build`
   - Output Directory: .next

6. Add Environment Variables:
   - Add all the environment variables from your `.env` file:
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY`
     - `R2_ACCOUNT_ID`
     - `R2_BUCKET`
     - `RPC_URL`
     - `POOL_CONFIG_KEY`

7. Click "Deploy"

8. Vercel will automatically deploy your site and provide you with a URL

### Environment Variables in Vercel

You can manage your environment variables in Vercel:

1. Go to your project settings
2. Click on "Environment Variables"
3. Add each variable from your `.env` file
4. You can set different values for Production, Preview, and Development environments

#### Recommended Vercel environment variables for Fun Launch

Add the following (at minimum) to your Vercel project settings -> Environment Variables:

- `RPC_URL` or `RPC_ENDPOINT` (server RPC used by API routes)
- `NEXT_PUBLIC_RPC_URL` (optional client RPC endpoint; only if the client needs direct RPC)
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET` (if using R2)
- `POOL_CONFIG_KEY`
- `MIGRATED_DBC_POOLS` (optional) — comma-separated list of migrated DBC pool addresses. Set this if
  you want the DAMM v2 exit planner to only consider a curated list of pools and to remove the
  `[universal-exit] MIGRATED_DBC_POOLS not set` warning.

Notes:

- Do NOT store private keys (like wallet private keys) in Vercel envs. Use secrets only for
  server-side API keys (RPC providers, R2 keys, etc.).
- After updating Vercel environment variables, trigger a redeploy so the server build picks up the
  new values.

### Custom Domain (Optional)

1. Go to your project settings in Vercel
2. Click on "Domains"
3. Add your custom domain
4. Follow Vercel's instructions to configure your DNS settings

## Features

- Create token pools with customizable price curves
- Upload token metadata and logos
- View token statistics and charts
- Track token transactions
- Mobile-friendly interface

## Tech Stack

- Next.js
- TypeScript
- Tailwind CSS
- Solana Web3.js
- Dynamic Bonding Curve SDK
- Cloudflare R2 for storage

## Universal Exit (DBC fees + DAMM v2)

The `/exit` page provides a Universal Exit flow that:

- Claims DBC trading fees (claim‑only; withdraw disabled pre‑migration)
- Removes 100% liquidity from detected DAMM v2 positions using `@meteora-ag/cp-amm-sdk`
- Uses wallet‑based position discovery; falls back to server build when needed
- Applies adaptive priority escalation: 250k → 337.5k → ~455k µ‑lamports/CU (cap 3M)

Environment notes:

- RPC: set one of `RPC_ENDPOINT`, `RPC_URL`, or `NEXT_PUBLIC_RPC_URL`
- `POOL_CONFIG_KEY`: supports comma‑separated keys; validated by `pnpm env:check`
- Optional `MIGRATED_DBC_POOLS`: comma‑separated list to restrict DAMM v2 exits

Try it locally:

1. `pnpm dev`
2. Open `/exit`, connect wallet, and click “Universal Exit (DBC fees + DAMM v2 withdraw)”

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
