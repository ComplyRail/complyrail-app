# Deployment

ComplyRail has two parts that deploy independently: the Soroban contract (Stellar testnet) and the dashboard (GitHub Pages). Both are automated with GitHub Actions; no local tooling is needed.

## 1. Contract → Stellar testnet

**Actions → Deploy to testnet → Run workflow**, then paste the admin wallet's **public** address (`G…`).

The workflow (`.github/workflows/deploy-testnet.yml`):

1. builds the contract with `stellar contract build`
2. creates a throwaway deployer key and funds it with Friendbot
3. deploys the contract; the constructor sets your address as admin, so no secret is ever needed
4. checks that `admin()` returns your address
5. commits the contract ID to `contracts/deployments/testnet.json`

Current deployment: [`CA5T254NPONJHMOA6UWKRPKW2UI3IUOQ6TWUQGP2NFPLAZWOSCVYXS5Q`](https://stellar.expert/explorer/testnet/contract/CA5T254NPONJHMOA6UWKRPKW2UI3IUOQ6TWUQGP2NFPLAZWOSCVYXS5Q)

To deploy from your machine instead (needs the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) v25.2+):

```bash
bash contracts/scripts/deploy-testnet.sh G...YOUR_ADMIN_ADDRESS
```

## 2. Dashboard → GitHub Pages

Every push to `main` runs `.github/workflows/pages.yml`. It builds the Next.js app as a static export and publishes it to **https://complyrail.github.io/complyrail-app/**.

The dashboard reads the contract ID from `contracts/deployments/testnet.json`, so a new contract deployment goes live on the site automatically. To use a different contract, set `NEXT_PUBLIC_CONTRACT_ID`.

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | value in `contracts/deployments/testnet.json` |
| `NEXT_PUBLIC_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_BASE_PATH` | empty (set to `/complyrail-app` by the Pages workflow) |

## 3. Demo data (optional)

**Actions → Seed testnet demo data** runs a full flow against the deployed contract:

- registers two demo VASPs and sets XLM thresholds
- submits four payments: one instant settlement, one attested and released, one rejected and refunded, one left pending

It signs as the admin, so it needs a repository secret named `TESTNET_ADMIN_SECRET` that holds the admin's **testnet** secret key (Settings → Secrets and variables → Actions). Never use a mainnet key.

## Asset registry (`config/assets.json`)

The dashboard's asset list comes from `config/assets.json`, read at build time. Change it and rebuild; no code change is needed. Each entry is:

| Field | Required | Rule |
|---|---|---|
| `symbol` | yes | 1–12 uppercase letters or digits, unique in the file |
| `native` | for XLM only | `true` for the native asset; it must not have an `issuer` |
| `issuer` | for issued assets | a valid Stellar public key (`G…`) |

Example:

```json
[
  { "symbol": "XLM", "native": true },
  { "symbol": "USDC", "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }
]
```

An invalid entry stops the build with an error that names the entry. The issuer must match the network the dashboard is built for (the testnet USDC issuer above is for testnet only).

## Local development

```bash
npm install --legacy-peer-deps
npm run dev                 # http://localhost:3000
npm test -- --run
npm run type-check && npm run lint

cd contracts/complyrail && cargo test
```
