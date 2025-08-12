name: Claim All Partner Fees

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  claim:
    runs-on: ubuntu-latest
    env:
      PNPM_CONFIG_FROZEN_LOCKFILE: 'false'
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install studio deps only
        run: pnpm -w --filter "./studio..." install --no-frozen-lockfile

      - name: Run claim_all_partner_fees script
        working-directory: studio
        env:
          RPC_URL: ${{ secrets.RPC_URL }}
          PRIVATE_KEY_B58: ${{ secrets.PRIVATE_KEY_B58 }}
        run: pnpm dlx tsx src/scripts/dbc/claim_all_partner_fees.ts
