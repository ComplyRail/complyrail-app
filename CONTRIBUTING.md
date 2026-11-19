# Contributing to ComplyRail

Thanks for helping out. This page takes you from a clean machine to a passing test run, and covers how to submit changes.

## 1. Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Git | any recent | cloning and branches |
| Node.js | 22 (matches CI) | the dashboard in the repo root |
| Rust (stable) | latest stable | the Soroban contract in `contracts/complyrail` |
| Stellar CLI | v25.2+ (CI uses v30) | building the WASM and deploying |

Install the Rust toolchain and the WASM target:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none
```

Install the Stellar CLI by following the [official guide](https://developers.stellar.org/docs/tools/cli).

## 2. Get the code and install dependencies

```bash
git clone https://github.com/ComplyRail/complyrail-app.git
cd complyrail-app
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required because of peer ranges in the wallet tooling. CI uses the same flag.

## 3. Run the tests

Dashboard (TypeScript, Vitest):

```bash
npm run type-check
npm run lint
npm test -- --run
```

Contract (Rust):

```bash
cd contracts/complyrail
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
stellar contract build    # optional: builds the WASM
```

If all of these pass, your clean setup is green.

## 4. Run the dashboard locally

```bash
npm run dev    # http://localhost:3000
```

The dashboard reads a deployed contract. The ID comes from `contracts/deployments/testnet.json`, or from `NEXT_PUBLIC_CONTRACT_ID` in `.env.local` if you want a different deployment.

## 5. Get testnet funds

Every testnet account needs funding before it can send anything.

1. Install [Freighter](https://www.freighter.app/) and switch it to **Testnet**.
2. Copy your account's public `G…` address.
3. Fund it with [Friendbot](https://lab.stellar.org/account/fund). Friendbot creates and funds the account in one step.
4. To use USDC, add a USDC trustline in your wallet before receiving it.

Friendbot only works on testnet. Never use testnet keys on mainnet.

## 6. Branches and commits

- Branch from `main`, using a short descriptive name such as `fix/balance-warning` or `feat/contributing-guide`.
- Keep each commit focused on one change, and write the subject in the imperative mood.
- Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes where they fit: `feat(app):`, `fix(contracts):`, `docs:`, `test:`, `ci:`.
- Don't commit secrets. Keys such as `TESTNET_ADMIN_SECRET` belong in GitHub secrets or your local `.env.local`, which is git-ignored.

## 7. Pull requests and Wave points

ComplyRail issues are part of the Stellar Wave programme.

- Wait to be assigned to an issue before you start work on it.
- Link your PR to the issue in the description with `Closes #<issue number>`. Put one line per issue if your PR covers several.
- Describe what changed and how you tested it. Include screenshots for UI changes.
- Make sure the commands in section 3 pass before you ask for review. CI runs the same checks.

## 8. Need help?

Open a GitHub issue or comment on the issue you're working on. For questions about the contract or deployment, see [contracts/README.md](contracts/README.md) and [DEPLOYMENT.md](DEPLOYMENT.md).
