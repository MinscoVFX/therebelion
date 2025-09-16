# Contributing to Meteora Invent

Thank you for your interest in contributing to Meteora Invent! This document provides guidelines and
instructions for contributing to this monorepo.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 9.0.0

### Installation

```bash
# Install pnpm globally
npm install -g pnpm@9

# Clone the repository
git clone https://github.com/MeteoraAg/meteora-invent.git
cd meteora-invent

# Install dependencies
pnpm install

# Setup git hooks
pnpm prepare
```

## Project Structure

```
meteora-invent/
├── packages/          # Shared packages
│   └── config/
│       ├── eslint/
│       ├── prettier/
│       └── typescript/
├── scaffolds/         # Scaffolds - production-ready frontend application templates
│   └── fun-launch/
└── studio/            # Studio - a collection of scripts for you to innovate and create
    ├── config
    │   ├── damm_v1_config.jsonc
    │   ├── damm_v2_config.jsonc
    │   ├── dbc_config.jsonc
    │   └── dlmm_config.jsonc
    ├── data
    │   ├── kv_proof.json
    │   └── whitelist_wallet.csv
    ├── LLM.txt
    ├── package.json
    ├── README.md
    ├── src
    │   ├── helpers
    │   │   ├── accounts.ts
    │   │   ├── cli.ts
    │   │   ├── common.ts
    │   │   ├── config.ts
    │   │   ├── index.ts
    │   │   ├── token.ts
    │   │   ├── transaction.ts
    │   │   ├── utils.ts
    │   │   └── validation.ts
    │   ├── lib
    │   │   ├── alpha_vault
    │   │   │   ├── index.ts
    │   │   │   ├── merkle_tree
    │   │   │   │   ├── balance_tree.ts
    │   │   │   │   ├── index.ts
    │   │   │   │   └── merkle_tree.ts
    │   │   │   └── utils.ts
    │   │   ├── damm_v1
    │   │   │   ├── index.ts
    │   │   │   └── stake2earn.ts
    │   │   ├── damm_v2
    │   │   │   └── index.ts
    │   │   ├── dbc
    │   │   │   └── index.ts
    │   │   └── dlmm
    │   │       └── index.ts
    │   ├── scripts
    │   │   ├── alpha_vault
    │   │   │   └── create_alpha_vault.ts
    │   │   ├── damm_v1
    │   │   │   ├── create_pool.ts
    │   │   │   ├── create_stake2earn_farm.ts
    │   │   │   ├── lock_liquidity_stake2earn.ts
    │   │   │   └── lock_liquidity.ts
    │   │   ├── damm_v2
    │   │   │   ├── create_balanced_pool.ts
    │   │   │   └── create_one_sided_pool.ts
    │   │   ├── dbc
    │   │   │   ├── claim_trading_fee.ts
    │   │   │   ├── create_config.ts
    │   │   │   ├── create_pool.ts
    │   │   │   ├── migrate_damm_v1.ts
    │   │   │   ├── migrate_damm_v2.ts
    │   │   │   └── swap.ts
    │   │   ├── dlmm
    │   │   │   ├── create_pool.ts
    │   │   │   ├── seed_liquidity_lfg.ts
    │   │   │   ├── seed_liquidity_single_bin.ts
    │   │   │   └── set_pool_status.ts
    │   │   └── settings
    │   │       └── generate_keypair.ts
    │   ├── tests
    │   │   ├── artifacts
    │   │   │   ├── accounts
    │   │   │   │   └── 3ifhD4Ywaa8aBZAaQSqYgN4Q1kaFArioLU8uumJMaqkE.json
    │   │   │   ├── alpha_vault.so
    │   │   │   ├── cp_amm.so
    │   │   │   ├── dynamic_amm.so
    │   │   │   ├── dynamic_bonding_curve.so
    │   │   │   ├── dynamic_fee_sharing.so
    │   │   │   ├── dynamic_vault.so
    │   │   │   ├── lb_clmm.so
    │   │   │   ├── locker.so
    │   │   │   └── metaplex.so
    │   │   └── keys
    │   │       └── localnet
    │   │           └── admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json
    │   └── utils
    │       ├── constants.ts
    │       └── types.ts
```

## Development Workflow

### Working with Workspaces

```bash
# Run commands in specific workspaces
pnpm --filter @meteora-invent/studio <command>
pnpm --filter @meteora-invent/scaffold/fun-launch <command>

# Run studio scripts
pnpm studio <script-name>

# Run scaffold commands
pnpm scaffold <command>
```

### Common Commands

```bash
# Build all packages
pnpm build

# Run development servers
pnpm dev

# Lint all packages
pnpm lint

# Format all packages
pnpm format

# Check formatting
pnpm format:check

# Check dependency versions
pnpm syncpack:check

# Fix dependency mismatches
pnpm syncpack:fix

# Clean all build artifacts
pnpm clean
```

## Code Style

### TypeScript

- We use strict TypeScript configurations
- All code must pass type checking
- Use explicit types where TypeScript inference is unclear
- Avoid `any` types; use `unknown` if type is truly unknown

### ESLint

- All code must pass ESLint checks
- We use shared ESLint configurations from `@meteora-invent/config/eslint`
- Run `pnpm lint` to check for issues
- Run `pnpm lint:fix` to auto-fix issues

### Prettier

- All code must be formatted with Prettier
- We use shared Prettier configuration from `@meteora-invent/config/prettier`
- Run `pnpm format` to format code
- Run `pnpm format:check` to check formatting

### Import Organization

Imports should be organized in the following order:

1. Built-in Node.js modules
2. External dependencies
3. Internal packages
4. Parent directory imports
5. Sibling imports
6. Index imports

## Testing

(Testing guidelines to be added as testing infrastructure is implemented)

## Commit Guidelines

We follow conventional commits specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements

### Examples

```bash
feat(studio): add new DLMM position management script
fix(scaffold): resolve wallet connection issue
docs: update README with new setup instructions
chore: update dependencies
```

## Pull Request Process

1. **Fork and Clone**: Fork the repository and clone your fork
2. **Branch**: Create a feature branch from `develop`

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Develop**: Make your changes following the guidelines above
4. **Test**: Ensure all tests pass and linting is clean
5. **Commit**: Use conventional commit messages
6. **Push**: Push your branch to your fork
7. **PR**: Open a pull request to the `develop` branch

### PR Checklist

- [ ] Code follows the project's style guidelines
- [ ] All tests pass
- [ ] Linting passes without errors
- [ ] Documentation is updated if needed
- [ ] Commit messages follow conventional commits
- [ ] PR description clearly describes the changes

### Review Process

1. All PRs require at least one review
2. CI checks must pass
3. Resolve all review comments
4. Squash commits if requested

## Environment Variables

When adding new scripts that require environment variables:

1. Update the `.env.example` file with new variables
2. Document the variables in the relevant README
3. Add validation in the script
4. Update `turbo.json` if the script needs specific env vars

## Adding New Packages

When adding a new package to the monorepo:

1. Create the package directory under the appropriate location
2. Initialize with proper `package.json` following naming conventions:
   - Studio: `@meteora-invent/studio`
   - Scaffolds: `@meteora-invent/scaffold/[name]`
   - Shared packages: `@meteora-invent/[name]`
3. Extend shared configurations where applicable
4. Update `pnpm-workspace.yaml` if needed
5. Add necessary scripts to `turbo.json`

## Questions?

If you have questions or need help:

1. Check existing issues and PRs
2. Open a new issue for bugs or feature requests
3. Join our [Discord](https://discord.com/invite/meteora)

Thank you for contributing to Meteora Invent! 🚀

## CI Tooling & pnpm Provisioning

We use `pnpm` via **Corepack** in CI instead of relying on a globally pre-installed binary. Some key
notes about the setup and a recent root cause analysis:

### Why Corepack Only?

Originally we attempted to mix a composite action with a nested `uses: pnpm/action-setup` step.
Composite actions cannot call other actions as normal shell steps in every context; this led to
nondeterministic PATH state early in jobs causing `Unable to locate executable file: pnpm` across
multiple workflows.

### Current Pattern

The custom action lives at `.github/actions/ensure-pnpm` and:

1. Enables Corepack (`corepack enable || true`)
2. Retries `corepack prepare pnpm@<version> --activate` up to 3 times
3. Verifies `pnpm -v`
4. Normalizes registry config (removes accidental custom scopes, sets retries & timeout)

Version is pinned (currently `10.14.0`) for full reproducibility.

### Adding New Workflows

Always add near the top of a job:

```yaml
      - name: Ensure pnpm
         uses: ./.github/actions/ensure-pnpm
```

Do **not** add a separate `pnpm/action-setup` step; the composite already handles provisioning.

### Common Failure Modes

| Symptom                                  | Likely Cause                                                 | Fix                                                  |
| ---------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `Unable to locate executable file: pnpm` | Action not invoked or earlier step exits before provisioning | Ensure the composite runs before cache/install steps |
| `corepack: command not found`            | Very old Node image (not in use here)                        | Upgrade Node to >=16.13 (we use 20+)                 |
| Network timeouts during prepare          | Transient registry issues                                    | Automatic retry handles most; re-run workflow        |

### Local Reproduction

You can emulate CI provisioning locally:

```bash
corepack disable || true
hash -r
node -v
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm -v
```

If that fails locally, CI will fail too—fix before pushing.

### Formatting & Consistency

Run `pnpm format` before committing to avoid CI `format:check` failures. A prior warning surfaced on
`package.json`; running the formatter resolved it.

---

If you encounter a new tooling issue, capture:

1. Workflow name + job + failing step
2. Full stderr block
3. `node -v` and whether the ensure step executed

Then open an issue tagged `ci`.
