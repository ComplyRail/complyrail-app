# complyrail-app

Compliance dashboard for ComplyRail — manage VASP registry, configure thresholds, review pending payments, and export audit logs.

**🚀 [Live Demo](https://complyrail-app.vercel.app)** | [Documentation](./DEPLOYMENT.md) | [Testing Guide](./VERCEL_DEPLOYMENT.md)

## Features

- **Wallet Auth**: Sign in with Stellar Wallets Kit (Freighter, xBull, Lobstr, etc.)
- **VASP Directory**: Register, suspend, and view Virtual Asset Service Providers
- **Threshold Config**: Set per-asset, per-jurisdiction compliance thresholds
- **Payment Queue**: Monitor and manually release/reject escrowed payments
- **Audit Log**: Export transaction history as CSV or JSON with on-chain verification links
- **Role-Based Access**: Admin, Compliance Officer, Viewer roles

## Smart Contract

The Soroban contract lives in [`contracts/`](contracts/README.md): VASP registry, per-asset/jurisdiction thresholds, payment escrow and IVMS101 attestation hashes, with 19 unit tests and CI.

> **Current status:** the contract is complete and tested. The dashboard still uses a mock client (`lib/sdk.ts`, `lib/mockData.ts`). Wiring it to the deployed testnet contract is the next milestone; see the roadmap in `contracts/README.md`.

## Tech Stack

- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Stellar Wallets Kit
- Prisma + Postgres (indexer)
- Soroban smart contract (Rust, `soroban-sdk` 29)

## License

Apache License 2.0 — see LICENSE file.

## Legal Notice

ComplyRail is a technical tool, not legal advice. FATF Travel Rule obligations vary by jurisdiction and carry real regulatory liability. Any team deploying this to production should have the architecture and IVMS101 handling reviewed by qualified legal/compliance counsel before processing real regulated payments.
