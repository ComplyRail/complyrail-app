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

## Deploy to testnet

```bash
**One click (no local setup):** GitHub → Actions → **Deploy to testnet** → *Run workflow*, and paste your wallet's public `G…` address as the admin. The job builds the contract, deploys it from a throwaway Friendbot-funded key, and writes the contract ID to the run summary.

**Locally** (needs the Stellar CLI):

```bash
bash contracts/scripts/deploy-testnet.sh G...YOUR_ADMIN_ADDRESS
```

Then set `NEXT_PUBLIC_CONTRACT_ID` for the dashboard (in `.env.local`, or in Vercel's environment variables).

## Status

- [x] Contract with registry, thresholds, escrow and attestations
- [x] Unit tests and CI (fmt, clippy, test, WASM build)
- [x] One-click testnet deploy workflow (records the ID in `deployments/testnet.json`)
- [x] Dashboard wired to the contract (no mocks)
- [ ] Persistent event indexer (RPC only keeps about 7 days of events)
- [ ] Off-chain IVMS101 exchange between VASPs (TRP / encrypted channel)
- [ ] Independent security review before any mainnet use

> ComplyRail is a technical tool, not legal advice. Travel Rule obligations vary by jurisdiction.
