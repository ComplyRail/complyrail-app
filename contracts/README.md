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
| `set_threshold(asset, jurisdiction, amount)` / `get_threshold` | admin / – | `amount` must be `0 ..= 9223372036854775807` (`i64::MAX`, the classic Stellar asset maximum); larger values fail with `InvalidThreshold` |
| `threshold_history(asset, jurisdiction, start, limit)` | – | Durable changelog per rule, oldest first. Keeps the last 100 changes; `seq` shows trimmed gaps. `limit` is capped at 100. |
| `submit_payment(from_vasp, to_vasp, beneficiary, asset, amount) -> id` | from_vasp | both VASPs must be active |
| `submit_attestation(id, hash, ivms_version)` | from_vasp | once per payment |
| `release_payment(id, caller)` | to_vasp or admin | requires attestation if over threshold |
| `reject_payment(id, caller, reason)` | to_vasp or admin | refunds originator |
| `reclaim_expired(id)` | from_vasp | only after `expires_at` |
| `get_payment`, `payment_count` | – | read |

Events use the same names as the dashboard's audit log: `vasp_reg`, `vasp_upd`, `thr_set`, `pay_sub`, `att_sub`, `pay_rel`, `pay_rej`.

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

Requirements: Rust stable with `rustup target add wasm32v1-none`, and [Stellar CLI](https://developers.stellar.org/docs/tools/cli) v25.2+ (`soroban-sdk` 29 must be built with `stellar contract build`).

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
