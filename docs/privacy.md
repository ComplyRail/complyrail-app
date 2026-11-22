# On-chain privacy in ComplyRail

ComplyRail keeps personal data (names, addresses, IVMS101 payloads) off the
ledger. It does **not** hide transaction metadata. Everything the contract
stores or emits is public on Stellar, and anyone can read it with a Horizon or
Soroban RPC node, an explorer, or the dashboard's audit log.

This document lists exactly what is public and what is not, and records the
assessment of whether beneficiary addresses should be stored as hashes.

## What is public

Every value below can be read by anyone without authorization.

| Data | Where it is visible | Source |
| --- | --- | --- |
| Originating VASP address | `get_payment`, `payments_for_vasp`, `pay_sub` event | `Payment.from_vasp` |
| Beneficiary VASP address | `get_payment`, `payments_for_vasp`, `pay_sub` event | `Payment.to_vasp` |
| **Beneficiary (end-user) address** | `get_payment` (storage) | `Payment.beneficiary` |
| Asset contract address | `get_payment`, `pay_sub` / `thr_set` events | `Payment.asset` |
| Amount | `get_payment`, `pay_sub` / `pay_rel` events | `Payment.amount` |
| Payment status and timestamps | `get_payment` | `status`, `created_at`, `expires_at`, `attested_at`, `resolved_at` |
| Whether attestation is required | `get_payment`, `pay_sub` event | `requires_attestation` |
| IVMS101 payload hash | `get_payment`, `att_sub` event | `attestation_hash` |
| IVMS101 version string | `get_payment`, `att_sub` event | `ivms_version` |
| VASP name, jurisdiction, public key, status, expiry | `get_vasp`, `vasp_reg` / `vasp_upd` events | `VaspEntry` (name and status are in storage; jurisdiction is also in the event) |
| Per-asset, per-jurisdiction thresholds | `get_threshold`, `thr_set` event | `DataKey::Threshold` |
| Rejection reason text | `pay_rej` event | `reason` argument |
| Which VASP a payment belongs to, and submission order | `payments_for_vasp` | `DataKey::VaspPayments` index |

Two consequences matter most:

1. **Counterparty graph.** Anyone can see which VASP sent how much of which
   asset to which VASP, and when.
2. **Beneficiary addresses are on-chain.** The `beneficiary` field is stored in
   the `Payment` struct, so it is readable through `get_payment` even though no
   event carries it.

## What is not public

- **Names, dates of birth, national IDs, postal addresses and any other
  IVMS101 natural-person or legal-person fields.** These are exchanged
  off-chain between the two VASPs, encrypted with the beneficiary VASP's
  registered public key.
- **The IVMS101 payload itself.** The contract only sees its 32-byte SHA-256
  hash.
- **Off-chain communication** between VASPs, and the dashboard's own session
  data, which stays in the browser and wallet.

## Assessment: should beneficiary addresses be stored as hashes?

**Question:** Would storing `H(beneficiary)` instead of the raw `beneficiary`
address reduce exposure?

**Finding: partly, and at a cost that does not justify it for this version.**

- *Benefit.* A hash hides the raw Stellar address from casual readers of
  `get_payment`, so it is harder to link a payment to a wallet by searching
  the explorer.
- *Limit: pseudonymous addresses are low-entropy to the public.* A Stellar
  account address is a public key that is already well known to whoever
  transacts with it. Anyone who has seen the address once can compute its hash
  and match it to the stored value. The hash protects only against readers who
  have never seen the address.
- *Limit: the beneficiary must still be paid.* `release_payment` transfers to
  `p.beneficiary`, so the contract must hold the real address to send funds.
  Storing only a hash would require the address to be supplied again at
  release time and checked against the hash, which moves the same data into
  transaction arguments that are equally public.
- *Limit: the on-chain transfer reveals it anyway.* Every settlement is an
  asset transfer to the beneficiary address, so the address appears in the
  ledger's operations and effects regardless of how the contract stores it.

**Decision:** keep storing the raw beneficiary address. Hashing it would not
hide it from the ledger's transfer history, and it adds an extra check at
release time without a clear privacy gain. Revisit this if the design changes
so that payouts go to a fresh, unlinked address per payment, or to a custodial
pool, in which case the stored address can stop being a long-lived identifier.

## Guidance for operators

- Do not put personal data in `reason`, `name`, `jurisdiction`, or any other
  string argument. These are public.
- Treat the IVMS101 hash as public. Keep the payload itself encrypted and
  share it only with the beneficiary VASP.
- Assume every amount, counterparty and beneficiary address is visible to
  competitors, regulators and the public.
- For high-sensitivity deployments, consider a permissioned or private Stellar
  network. That is an infrastructure decision and is outside this contract.

This document is a technical summary, not legal advice. See the legal notice
in the [README](../README.md#legal-notice).
