# complyrail-app

Compliance dashboard for ComplyRail — manage VASP registry, configure thresholds, review pending payments, and export audit logs.

**[Deployment](./DEPLOYMENT.md)** | [Contract docs](./contracts/README.md) | [On-chain privacy](./docs/privacy.md)

## Features

- **Wallet Auth**: Sign in with Stellar Wallets Kit (Freighter, xBull, Lobstr, etc.)
- **VASP Directory**: Register, suspend, and view Virtual Asset Service Providers
- **Threshold Config**: Set per-asset, per-jurisdiction compliance thresholds
- **Payment Queue**: Escrowed payments with IVMS101 attestation, release, reject and reclaim
- **Audit Log**: Permanently indexed contract events, exportable as CSV/JSON with explorer links
- **On-chain roles**: Admin, VASP and Viewer, derived from contract state

## Smart Contract

The Soroban contract lives in [`contracts/`](contracts/README.md): VASP registry, per-asset/jurisdiction thresholds, payment escrow and IVMS101 attestation hashes, with unit tests and CI.

Personal data stays off-chain, but amounts, asset addresses, VASP addresses and beneficiary addresses are public on the ledger. See [`docs/privacy.md`](./docs/privacy.md) for exactly what is public and what is not.

The dashboard talks to the deployed contract directly via `@stellar/stellar-sdk` and signs with the connected wallet (Stellar Wallets Kit). There is no mock data: every table is read from testnet, and every button sends a real transaction.

### Deploying

GitHub → **Actions** → **Deploy to testnet** → *Run workflow*, and paste your wallet's public `G…` address as the admin. The workflow deploys the contract and commits its ID to `contracts/deployments/testnet.json`, which the dashboard reads automatically.

**Current testnet deployment:** [`CA5T254NPONJHMOA6UWKRPKW2UI3IUOQ6TWUQGP2NFPLAZWOSCVYXS5Q`](https://stellar.expert/explorer/testnet/contract/CA5T254NPONJHMOA6UWKRPKW2UI3IUOQ6TWUQGP2NFPLAZWOSCVYXS5Q)

The dashboard is deployed to Vercel on every push to `main` (`.github/workflows/deploy-vercel.yml`). Its audit index is stored in Turso and updated daily by a Vercel Cron Job.

**Demo data:** **Actions** → **Seed testnet demo data** runs a full flow on-chain: two demo VASPs, thresholds, an instant settlement, an attest + release, a rejection and a pending payment. It needs a `TESTNET_ADMIN_SECRET` repository secret (the admin's testnet key).

### Try it on testnet

1. Install [Freighter](https://www.freighter.app/), switch it to **Testnet**, and fund the account with [Friendbot](https://lab.stellar.org/account/fund).
2. Connect the admin wallet → **VASPs** → register two VASP accounts (each also funded on testnet).
3. **Thresholds** → for example, XLM / `*` = 100.
4. Connect as VASP A → **Submit Payment** to VASP B. Below the threshold it settles straight away; at or above it, it's held.
5. As VASP A, open the payment → **Hash & submit attestation**. As VASP B (or the admin) → **Release**.
6. **Audit Log** shows every on-chain event, exportable as CSV or JSON.

## Development

New here? [CONTRIBUTING.md](./CONTRIBUTING.md) walks through setup from a clean machine, getting testnet funds, and how to submit a PR.

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000
npm test -- --run    # unit tests
npm run type-check && npm run lint
```

Set `NEXT_PUBLIC_CONTRACT_ID` in `.env.local` to point at a different deployment. For local audit indexing, also configure `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `CRON_SECRET`; deployment setup is in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Tech Stack

- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Stellar Wallets Kit
- Soroban smart contract (Rust, `soroban-sdk` 29)

## License

Apache License 2.0 — see LICENSE file.

## Legal Notice

ComplyRail is a technical tool, not legal advice. FATF Travel Rule obligations vary by jurisdiction and carry real regulatory liability. Any team deploying this to production should have the architecture and IVMS101 handling reviewed by qualified legal/compliance counsel before processing real regulated payments.
