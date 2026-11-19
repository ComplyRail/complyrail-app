# ComplyRail Soroban Contract

On-chain FATF Travel Rule enforcement for Stellar anchors. One contract combines four parts:

| Part | What it does |
|---|---|
| **VASP registry** | Admin registers Virtual Asset Service Providers (name, jurisdiction, encryption key, optional expiry) and can suspend, revoke or re-activate them. |
| **Thresholds** | Per `(asset, jurisdiction)` amount at or above which a payment needs a Travel Rule attestation. `"*"` is the fallback jurisdiction. If nothing is configured, the threshold is `0` (fail closed: every payment needs an attestation). |
| **Escrow** | `submit_payment` moves tokens from the originating VASP into the contract. Below-threshold payments settle in the same call. Others are held until released, rejected (refund) or reclaimed after expiry. |
| **Attestations** | The originating VASP records a sha256 hash of the IVMS101 payload it sent off-chain, plus the IVMS101 version. No personal data goes on-chain. |

## Payment flow

```
originator VASP                     contract                      beneficiary VASP
      | submit_payment ------------>  | tokens -> escrow
      |                               | amount < threshold? -> released to beneficiary
      |                               | else: Pending
      | (IVMS101 payload sent off-chain) --------------------------------> |
      | submit_attestation(hash) ---> |
      |                               | <------------- release_payment / reject_payment
      |                               | released -> beneficiary | rejected -> refund originator
      | reclaim_expired (after TTL) ->| refund originator
```

## Interface

| Function | Auth | Notes |
|---|---|---|
| `__constructor(admin, payment_ttl?)` | – | runs at deploy time, so setup can't be front-run; TTL defaults to 7 days |
| `transfer_admin(new_admin)` | admin + new admin | |
| `register_vasp(address, name, jurisdiction, public_key, expires_at?)` | admin | |
| `set_vasp_status(address, status)` | admin | `Active` / `Suspended` / `Revoked` |
| `set_vasp_expiry(address, expires_at?)` | admin | |
| `get_vasp`, `is_vasp_active`, `list_vasps` | – | read |
| `set_threshold(asset, jurisdiction, amount)` / `get_threshold` | admin / – | |
| `submit_payment(from_vasp, to_vasp, beneficiary, asset, amount) -> id` | from_vasp | both VASPs must be active |
| `submit_attestation(id, hash, ivms_version)` | from_vasp | once per payment |
| `release_payment(id, caller)` | to_vasp or admin | requires attestation if over threshold |
| `reject_payment(id, caller, reason)` | to_vasp or admin | refunds originator |
| `reclaim_expired(id)` | from_vasp | only after `expires_at` |
| `get_payment`, `payment_count` | – | read |

Events use the same names as the dashboard's audit log: `vasp_reg`, `vasp_upd`, `thr_set`, `pay_sub`, `att_sub`, `pay_rel`, `pay_rej`.

## Develop

```bash
cd contracts/complyrail
cargo test                                         # unit tests
stellar contract build                             # builds the WASM
```

Requirements: Rust stable with `rustup target add wasm32v1-none`, and [Stellar CLI](https://developers.stellar.org/docs/tools/cli) v25.2+ (`soroban-sdk` 29 must be built with `stellar contract build`).

## WASM size budget

CI records the size of the release WASM in the job summary and fails if it grows more than 5% over `contracts/complyrail/wasm-size-baseline.txt`. The file holds the size in bytes of the last accepted build.

When a change makes the contract bigger on purpose, update the baseline in the same PR:

```bash
cd contracts/complyrail
stellar contract build
stat -c %s target/wasm32v1-none/release/complyrail.wasm > wasm-size-baseline.txt
```

Explain the growth in the PR description.

## Dependency advisories

CI runs `cargo deny check advisories` against the RustSec database on every change to the contract. The policy lives in `contracts/complyrail/deny.toml`.

- **Failing:** any vulnerability advisory fails the job, whatever its severity. Unmaintained crates that are direct dependencies also fail.
- **Run locally:** `cd contracts/complyrail && cargo deny check advisories` (install with `cargo install cargo-deny --locked`).

**Exception process.** To accept an advisory that cannot be fixed yet:

1. Confirm the advisory is not reachable from the contract, or that no fixed release can be selected. Check `cargo tree -i <crate>`.
2. Add an entry to `ignore` in `deny.toml` with the advisory ID and a `reason` that names the path and the blocker.
3. Note the exception and its review trigger (for example, the next `soroban-sdk` bump) in the PR description.
4. Get a second maintainer to approve the PR. Remove the entry as soon as a fix is available.

## Reproducible builds

Anyone can rebuild the deployed WASM from this repository and check its hash. Three inputs are pinned:

| Input | Pinned to | Where |
|---|---|---|
| Rust toolchain | 1.99.1 | `complyrail/rust-toolchain.toml`, and the CI and deploy workflows |
| Stellar CLI | 30.0.1 | `stellar/stellar-cli@v30.0.1` in the workflows. Its version is embedded in the WASM as `cliver`. |
| Dependencies | exact versions | `complyrail/Cargo.lock` |

To verify the testnet deployment:

```bash
# 1. Check out the commit recorded in deployments/testnet.json
git checkout "$(jq -r .commit contracts/deployments/testnet.json)"

# 2. Build with stellar-cli 30.0.1. rustup selects Rust 1.99.1 from rust-toolchain.toml.
cd contracts/complyrail
stellar contract build
sha256sum target/wasm32v1-none/release/complyrail.wasm

# 3. Compare with the deployed WASM
stellar contract fetch --id "$(jq -r .contractId ../deployments/testnet.json)" --network testnet -o deployed.wasm
sha256sum deployed.wasm
```

Both hashes should match `wasmHash` in `deployments/testnet.json`. CI builds the contract twice from a clean target directory on every change and fails if the two hashes differ.

If you change the toolchain or the CLI version, rebuild, confirm the hash, and update the pins in all three places above together. Also refresh `wasm-size-baseline.txt`.

## Deploy to testnet

```bash
**One click (no local setup):** GitHub → Actions → **Deploy to testnet** → *Run workflow*, and paste your wallet's public `G…` address as the admin. The job builds the contract, deploys it from a throwaway Friendbot-funded key, and writes the contract ID to the run summary.

**Locally** (needs the Stellar CLI):

```bash
bash contracts/scripts/deploy-testnet.sh G...YOUR_ADMIN_ADDRESS
```

Then set `NEXT_PUBLIC_CONTRACT_ID` for the dashboard (in `.env.local`). The GitHub Pages site reads `contracts/deployments/testnet.json` automatically.

## Status

- [x] Contract with registry, thresholds, escrow and attestations
- [x] Unit tests and CI (fmt, clippy, test, WASM build)
- [x] One-click testnet deploy workflow (records the ID in `deployments/testnet.json`)
- [x] Dashboard wired to the contract (no mocks)
- [ ] Persistent event indexer (RPC only keeps about 7 days of events)
- [ ] Off-chain IVMS101 exchange between VASPs (TRP / encrypted channel)
- [ ] Independent security review before any mainnet use

> ComplyRail is a technical tool, not legal advice. Travel Rule obligations vary by jurisdiction.
