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
| `__constructor(admin, threshold_admin, payment_ttl?)` | – | runs at deploy time, so setup can't be front-run; `threshold_admin` should be a different key from `admin`; TTL defaults to 7 days, max 100 years (larger values are rejected, so `now + ttl` cannot overflow) |
| `propose_admin(new_admin)` | admin | replaces any earlier proposal; the new admin takes over only after `accept_admin` |
| `accept_admin(caller)` | proposed admin | `Unauthorized` for any other address; `NoPendingAdmin` if nothing is proposed |
| `cancel_admin_proposal()` | admin | `NoPendingAdmin` if nothing is proposed |
| `pending_admin` | – | read |
| `register_vasp(address, name, jurisdiction, public_key, expires_at?)` | admin | jurisdiction must not be empty or `"*"` (`InvalidJurisdiction`) |
| `set_vasp_status(address, status, reason)` | admin | `Active` / `Suspended` / `Revoked`. Suspend and revoke need a non-empty `reason` (max 256 bytes). `Revoked` is final. |
| `set_vasp_expiry(address, expires_at?)` | admin | |
| `update_vasp(address, name, jurisdiction)` | admin | same jurisdiction rule as `register_vasp`; emits `vasp_upd` with old and new values; changes apply to payments submitted afterwards, pending payments keep the jurisdiction they were submitted under |
| `rotate_vasp_key(address, new_key)` | admin | replaces the encryption key only; emits `vasp_upd` with sha256 of old and new keys; payments are unaffected |
| `get_vasp`, `is_vasp_active`, `list_vasps` | – | read |
| `set_threshold(asset, jurisdiction, amount)` / `get_threshold` | threshold admin / – | `amount` must be `0 ..= 9223372036854775807` (`i64::MAX`, the classic Stellar asset maximum); larger values fail with `InvalidThreshold`. The threshold admin is a separate role from the admin, so one key cannot both admit a VASP and lower a threshold. Setting `0` drops the rule from `list_thresholds` but still answers `get_threshold` with 0 (no `"*"` fallback) |
| `remove_threshold(asset, jurisdiction)` | threshold admin | Fails with `ThresholdNotFound` if no threshold is set for that jurisdiction |
| `list_thresholds` | – | `(asset, jurisdiction, amount)` for every rule above 0 |
| `threshold_history(asset, jurisdiction, start, limit)` | – | Durable changelog per rule, oldest first. Keeps the last 100 changes; `seq` shows trimmed gaps. `limit` is capped at 100. |
| `submit_payment(from_vasp, to_vasp, beneficiary, asset, amount) -> id` | from_vasp | both VASPs must be active |
| `submit_attestation(id, hash, ivms_version)` | from_vasp | once per payment; only before `expires_at` |
| `release_payment(id, caller)` | to_vasp or admin | requires attestation if over threshold; only before `expires_at` |
| `reject_payment(id, caller, reason, evidence_hash?)` | to_vasp or admin | refunds originator; `reason` must not be empty or whitespace-only (`InvalidInput`), max 256 bytes; `evidence_hash` is the sha256 of the off-chain evidence document (UTF-8 JSON), emitted in `pay_rej` |
| `reclaim_expired(id)` | from_vasp | only after `expires_at` |
| `get_payment`, `payment_count` | – | read |
| `list_payments(start, limit)` | – | ids `start..start+limit`, ascending; `limit` capped at 100 |
| `list_payments_by_vasp(vasp, start, limit)` | – | that VASP's payments (as originator or beneficiary), in submission order; same cap (100) |

### Release and reclaim windows

A held payment has one window per party, and they never overlap:

| Ledger time `now` | Attest / release / reject | Reclaim |
|---|---|---|
| `now < expires_at` | allowed | `PaymentNotExpired` |
| `now >= expires_at` | `PaymentExpired` (no grace period) | allowed (originator) |

The boundary is inclusive for reclaim: at exactly `expires_at` the originator can reclaim and the beneficiary can no longer release. Whichever transaction lands first can therefore never race the other.

### Storage lifetime (escrow must not be archived)

Soroban archives a persistent entry once its TTL runs out, so an untouched held payment must stay live until its reclaim window opens. Every write and every load of a payment, and every instance write, extends its TTL to:

`payment_ttl` (ledgers, at 5 s per ledger) + 30 days buffer

| Setting | Before | Now (default 7-day TTL) | Now (60-day TTL) |
|---|---|---|---|
| Untouched Pending payment survives, from last write | 30 days, whatever `payment_ttl` is | about 37 days | about 90 days |

The old fixed 30-day horizon was enough for the 7-day default, but any `payment_ttl` above 30 days let an untouched payment be archived before the originator could reclaim it. The contract instance (TTL config and VASP list) uses the same horizon so it never expires before the payments it governs. The horizon is still capped by the network's maximum entry TTL.

Events use the same names as the dashboard's audit log: `vasp_reg`, `vasp_upd`, `thr_set`, `pay_sub`, `att_sub`, `pay_rel`, `pay_rej`, `pay_recl`.

## Error codes

The dashboard maps these numbers, so they are stable. Never renumber a code, and never reuse a retired one.

| Code | Variant | Status | Meaning |
|---|---|---|---|
| 1 | `AlreadyInitialized` | **reserved (retired)** | Setup moved to the constructor. Cannot be returned. |
| 2 | `NotInitialized` | active | Constructor never ran. Unreachable after deployment. |
| 3 | `VaspAlreadyRegistered` | active | VASP address is already in the registry. |
| 4 | `VaspNotFound` | active | No VASP registered at this address. |
| 5 | `VaspNotActive` | active | VASP is suspended, revoked or expired. |
| 6 | `InvalidAmount` | active | Payment amount is not positive. |
| 7 | `PaymentNotFound` | active | No payment with this id. |
| 8 | `PaymentNotPending` | active | Payment is already released, rejected or reclaimed. |
| 9 | `AttestationRequired` | active | Payment is at or above threshold and has no attestation yet. |
| 10 | `AttestationAlreadySubmitted` | active | Payment already has an attestation. |
| 11 | `Unauthorized` | active | Caller is neither the beneficiary VASP nor the admin. |
| 12 | `PaymentNotExpired` | active | Payment cannot be reclaimed before `expires_at`. |
| 13 | `SameVasp` | active | Originator and beneficiary VASP are the same. |
| 14 | `InvalidThreshold` | active | Threshold is negative or above `i64::MAX`. |

## Develop

```bash
cd contracts/complyrail
cargo test                                         # unit tests
stellar contract build                             # builds the WASM
```

Requirements: Rust stable with `rustup target add wasm32v1-none`, and [Stellar CLI](https://developers.stellar.org/docs/tools/cli) **v30.0.1** (the same version the GitHub workflows pin; `soroban-sdk` 29 must be built with `stellar contract build`). `contracts/scripts/deploy-testnet.sh` checks the installed version and exits if it does not match.

## Reading the contract from Rust

Copy-paste examples for querying the contract from an external Rust dApp,
indexer, or CLI tool are in [docs/contract-reads.md](../docs/contract-reads.md).
No transaction is submitted for reads; simulation-only calls are free.

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
