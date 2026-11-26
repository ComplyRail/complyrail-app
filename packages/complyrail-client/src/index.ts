import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  /**
   * Retired (code 1 is reserved and must never be reused). Setup moved to
   * the constructor, so this can no longer be returned.
   */
  1: {message:"AlreadyInitialized"},
  /**
   * Only returned if the constructor never ran. Unreachable after deployment.
   */
  2: {message:"NotInitialized"},
  3: {message:"VaspAlreadyRegistered"},
  4: {message:"VaspNotFound"},
  5: {message:"VaspNotActive"},
  6: {message:"InvalidAmount"},
  7: {message:"PaymentNotFound"},
  8: {message:"PaymentNotPending"},
  9: {message:"AttestationRequired"},
  10: {message:"AttestationAlreadySubmitted"},
  11: {message:"Unauthorized"},
  12: {message:"PaymentNotExpired"},
  /**
   * The payment's `expires_at` has passed: it can no longer be attested
   * or released, only reclaimed by the originator.
   */
  36: {message:"PaymentExpired"},
  /**
   * The contract received a different amount than the one requested,
   * e.g. the token charges a transfer fee.
   */
  32: {message:"ReceivedAmountMismatch"},
  /**
   * The asset is not on the admin's allowlist for escrow.
   */
  33: {message:"AssetNotAllowed"},
  /**
   * New payments and releases are blocked while the contract is paused.
   */
  34: {message:"Paused"},
  /**
   * Requested TTL is outside [MIN_PAYMENT_TTL, MAX_PAYMENT_TTL].
   */
  35: {message:"InvalidTtl"},
  /**
   * `now + ttl` does not fit in a u64.
   */
  38: {message:"ExpiryOverflow"},
  /**
   * `accept_admin` or `cancel_admin_proposal` was called with no proposal pending.
   */
  37: {message:"NoPendingAdmin"},
  13: {message:"SameVasp"},
  14: {message:"InvalidThreshold"},
  /**
   * A revoked VASP is terminal and cannot change status again.
   */
  15: {message:"VaspRevoked"},
  /**
   * Suspending or revoking a VASP requires a non-empty reason.
   */
  16: {message:"ReasonRequired"},
  /**
   * Reason exceeds `MAX_REASON_LEN` bytes.
   */
  17: {message:"ReasonTooLong"},
  /**
   * A supplied value is malformed, e.g. an expiry that is already past.
   */
  18: {message:"InvalidInput"},
  /**
   * `remove_threshold` was called for a jurisdiction with no threshold.
   */
  19: {message:"ThresholdNotFound"},
  /**
   * Jurisdiction code is not on the allowlist.
   */
  20: {message:"UnknownJurisdiction"},
  /**
   * Jurisdiction is empty or the `"*"` wildcard, which is reserved for
   * threshold fallback rules and cannot name a VASP's jurisdiction.
   */
  21: {message:"InvalidJurisdiction"},
  /**
   * The receiving VASP is still active, so the originator cannot reclaim early.
   */
  22: {message:"ReceiverStillActive"},
  /**
   * Batch size exceeds `MAX_REFUND_BATCH`.
   */
  23: {message:"BatchTooLarge"},
  /**
   * Holding this payment would push the originator's escrow exposure over its cap.
   */
  24: {message:"ExposureCapExceeded"},
  /**
   * Payment amount is below the configured minimum for the asset.
   */
  25: {message:"BelowMinAmount"},
  /**
   * Beneficiary acknowledgement was recorded for this payment.
   */
  26: {message:"AlreadyAcknowledged"},
  /**
   * The payment has no attestation amendment to acknowledge.
   */
  27: {message:"AttestationNotAcknowledged"},
  /**
   * Payment already has an attestation, so the originator can no longer cancel it.
   */
  28: {message:"AlreadyAttested"},
  /**
   * The token transfer failed (insufficient balance, missing trustline or
   * the recipient is not authorised to receive the asset).
   */
  29: {message:"TransferFailed"},
  /**
   * The originating VASP already has the maximum number of held payments open.
   */
  30: {message:"OpenLimitReached"},
  31: {message:"InvalidLimit"}
}


export interface Payment {
  /**
 * Set when `to_vasp` confirms it has checked the IVMS101 payload.
 */
acknowledged_at: Option<u64>;
  amount: i128;
  asset: string;
  /**
 * sha256 of the IVMS101 payload exchanged off-chain.
 */
attestation_hash: Option<Buffer>;
  attested_at: Option<u64>;
  beneficiary: string;
  created_at: u64;
  /**
 * Ledger sequence at submission, for ordering events against the ledger.
 */
created_ledger: u32;
  expires_at: u64;
  /**
 * Optional reference from the originator's own system (e.g. an anchor's
 * transfer id), so on-chain payments can be matched to off-chain records.
 */
external_ref: Option<Buffer>;
  from_vasp: string;
  id: u64;
  ivms_version: Option<string>;
  requires_attestation: boolean;
  resolved_at: Option<u64>;
  /**
 * Ledger sequence at release, rejection or reclaim.
 */
resolved_ledger: Option<u32>;
  status: PaymentStatus;
  to_vasp: string;
}



export interface VaspEntry {
  added_at: u64;
  address: string;
  /**
 * Optional unix timestamp after which the VASP is treated as inactive.
 */
expires_at: Option<u64>;
  jurisdiction: string;
  name: string;
  /**
 * Key used off-chain to encrypt IVMS101 payloads for this VASP.
 */
public_key: Buffer;
  status: VaspStatus;
}

export type VaspStatus = {tag: "Active", values: void} | {tag: "Suspended", values: void} | {tag: "Revoked", values: void};



export type PaymentStatus = {tag: "Pending", values: void} | {tag: "Queried", values: void} | {tag: "Released", values: void} | {tag: "Rejected", values: void} | {tag: "Reclaimed", values: void} | {tag: "Cancelled", values: void};








export interface ThresholdChange {
  amount: i128;
  changed_at: u64;
  /**
 * Per-rule sequence number, starting at 0 and never reset. A jump in
 * `seq` between retained entries means older changes were trimmed.
 */
seq: u64;
}












export interface Client {
  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_vasp: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<VaspEntry>>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a list_vasps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Up to `limit` (capped at `MAX_VASP_PAGE`) registered VASP addresses,
   * starting at index `start`. Returns an empty list past the end.
   */
  list_vasps: ({start, limit}: {start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin pauses or resumes new payments and releases. `reject_payment`
   * and `reclaim_expired` stay available so funds can always be returned.
   */
  set_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a vasp_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Number of VASPs ever registered (the valid `list_vasps` index range).
   */
  vasp_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_payment: ({payment_id}: {payment_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Payment>>>

  /**
   * Construct and simulate a payment_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  payment_ttl: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a update_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Change a VASP's legal name and/or jurisdiction (admin only).
   * 
   * Jurisdiction decides which threshold applies, so the change only
   * affects payments submitted after it. A payment's `requires_attestation`
   * is fixed when it is submitted, so pending payments keep the jurisdiction
   * they were submitted under: neither their attestation requirement nor
   * their release path changes. The old and new values are emitted on
   * `vasp_upd`.
   */
  update_vasp: ({address, name, jurisdiction}: {address: string, name: string, jurisdiction: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 2: the proposed admin accepts. `caller` must be the proposed
   * address and must sign; any other address gets `Unauthorized`.
   */
  accept_admin: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_exposure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sum of `vasp`'s currently held (pending) amounts in `asset`.
   */
  get_exposure: ({vasp, asset}: {vasp: string, asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a list_pending transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payment ids currently held in escrow (awaiting attestation and/or
   * release), in submission order. Paged like `payments_for_vasp`.
   */
  list_pending: ({start, limit}: {start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a get_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unknown or malformed codes read the `"*"` fallback, the same rule a
   * payment from an unrecognised jurisdiction would hit.
   */
  get_threshold: ({asset, jurisdiction}: {asset: string, jurisdiction: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a list_payments transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payments with ids `start..start+limit`, ascending. `limit` is capped at
   * `MAX_PAGE_SIZE`; a page past the end (or `limit` 0) is empty.
   */
  list_payments: ({start, limit}: {start: u64, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Payment>>>

  /**
   * Construct and simulate a payment_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Number of payments ever submitted (ids are `0..payment_count`).
   */
  payment_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The proposed admin awaiting `accept_admin`, if any.
   */
  pending_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Step 1 of a handover: the current admin proposes `new_admin`. Replaces
   * any earlier proposal and changes nothing until `accept_admin`.
   */
  propose_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a query_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Beneficiary VASP asks the originator for more information about a
   * held payment. Moves `Pending` to `Queried`. Not possible once the
   * attestation is acknowledged; reject instead.
   */
  query_payment: ({payment_id, reason}: {payment_id: u64, reason: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_vasp: ({address, name, jurisdiction, public_key, expires_at}: {address: string, name: string, jurisdiction: string, public_key: Buffer, expires_at: Option<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Amount (in the asset's smallest unit) at or above which a payment
   * originating from `jurisdiction` needs an attestation. Use `"*"` as a
   * fallback for jurisdictions without their own rule.
   */
  set_threshold: ({asset, jurisdiction, amount}: {asset: string, jurisdiction: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Originating VASP withdraws a held payment before any attestation was
   * submitted. Funds return to the originator immediately, without waiting
   * for the reclaim window.
   */
  cancel_payment: ({payment_id}: {payment_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_min_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Smallest accepted payment in `asset` (0 when unset).
   */
  get_min_amount: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a is_vasp_active transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * True if the VASP exists, is `Active` and has not expired.
   */
  is_vasp_active: ({address}: {address: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a reject_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Beneficiary VASP or admin rejects a held payment; funds go back to the
   * originating VASP. Allowed while `Pending` or `Queried`. `reason` is
   * emitted for the audit trail.
   * 
   * `evidence_hash` is optional. When given it must be the sha256 of the
   * evidence document that justified the rejection, serialised as UTF-8
   * JSON and exchanged off-chain between the VASPs and the admin. Only the
   * hash is emitted in `pay_rej`; the document itself, and any personal
   * data in it, never touches the ledger. Anyone reading the audit log can
   * check a disclosed document by hashing it and comparing.
   */
  reject_payment: ({payment_id, caller, reason, evidence_hash}: {payment_id: u64, caller: string, reason: string, evidence_hash: Option<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_min_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin sets the smallest payment accepted in `asset`. `0` disables the
   * minimum (any positive amount is accepted).
   */
  set_min_amount: ({asset, amount}: {asset: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Originating VASP sends `amount` of `asset` towards `beneficiary` at
   * `to_vasp`. Tokens move into escrow. Below-threshold payments settle in
   * the same call; others stay `Pending`. Returns the payment id.
   */
  submit_payment: ({from_vasp, to_vasp, beneficiary, asset, amount, external_ref}: {from_vasp: string, to_vasp: string, beneficiary: string, asset: string, amount: i128, external_ref: Option<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a list_thresholds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Every configured rule with a non-zero amount, as
   * `(asset, jurisdiction, amount)`. A rule set to 0 is dropped from this
   * list but still answers `get_threshold` with 0.
   */
  list_thresholds: (options?: MethodOptions) => Promise<AssembledTransaction<Array<readonly [string, string, i128]>>>

  /**
   * Construct and simulate a reclaim_expired transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * After `expires_at`, the originating VASP can pull back a payment that
   * was never released or rejected, so funds can't get stuck. This also
   * applies while the payment is `Queried`.
   */
  reclaim_expired: ({payment_id}: {payment_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a release_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Beneficiary VASP or admin releases a held payment to the beneficiary.
   * The beneficiary must have acknowledged the attestation first. The admin
   * may release without acknowledgement; that override emits `pay_ovr`.
   */
  release_payment: ({payment_id, caller}: {payment_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a rotate_vasp_key transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Replace a VASP's encryption key (admin only). Only the key used to
   * encrypt future IVMS101 payloads changes: payments already in flight
   * keep their from/to VASP addresses, amounts, status and attestation.
   */
  rotate_vasp_key: ({address, new_key}: {address: string, new_key: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_payment_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin sets how long a held payment may wait before the originator can
   * reclaim it. Applies only to payments created after this call.
   */
  set_payment_ttl: ({seconds}: {seconds: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_vasp_expiry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_vasp_expiry: ({address, expires_at}: {address: string, expires_at: Option<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_vasp_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets a VASP's status. Suspending or revoking requires a non-empty
   * `reason`; any reason is capped at `MAX_REASON_LEN` bytes. The reason is
   * emitted in `VaspUpdated` for the audit trail.
   */
  set_vasp_status: ({address, status, reason}: {address: string, status: VaspStatus, reason: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_exposure_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current cap for `vasp` in `asset`, or `None` when uncapped.
   */
  get_exposure_cap: ({vasp, asset}: {vasp: string, asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<i128>>>

  /**
   * Construct and simulate a is_asset_allowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_asset_allowed: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a reclaim_inactive transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Originating VASP reclaims a held payment immediately when the
   * receiving VASP is no longer active (revoked, suspended or expired),
   * instead of waiting for `expires_at`.
   */
  reclaim_inactive: ({payment_id}: {payment_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deletes the exact `(asset, jurisdiction)` rule so the `"*"` fallback
   * applies to that jurisdiction again. Fails with `ThresholdNotFound` if no
   * rule is set for that exact jurisdiction.
   */
  remove_threshold: ({asset, jurisdiction}: {asset: string, jurisdiction: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_exposure_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Caps the total value `vasp` may hold in escrow in `asset` at once.
   * Only held (attestation-required) payments count. Without a cap the
   * originator is unlimited.
   */
  set_exposure_cap: ({vasp, asset, amount}: {vasp: string, asset: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a amend_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Originating VASP replaces the attestation of a held payment, for
   * example to send a corrected IVMS101 payload. Allowed only until the
   * beneficiary acknowledges. The superseded hash is emitted in `att_amd`.
   */
  amend_attestation: ({payment_id, attestation_hash, ivms_version}: {payment_id: u64, attestation_hash: Buffer, ivms_version: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a payments_for_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payment ids in which `vasp` is either originator or beneficiary, in
   * submission order. Returns at most `min(limit, MAX_PAGE_SIZE)` ids
   * starting at offset `start`; an out-of-range `start` yields an empty Vec.
   */
  payments_for_vasp: ({vasp, start, limit}: {vasp: string, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a set_asset_allowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin adds or removes `asset` from the set that may be escrowed.
   * Payments in any other asset are rejected.
   */
  set_asset_allowed: ({asset, allowed}: {asset: string, allowed: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a threshold_history transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Changelog for one `(asset, jurisdiction)` rule, oldest first. Returns up
   * to `limit` entries (capped at `MAX_THRESHOLD_HISTORY`) starting at index
   * `start` of the retained history. Past the end returns an empty list.
   */
  threshold_history: ({asset, jurisdiction, start, limit}: {asset: string, jurisdiction: string, start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<ThresholdChange>>>

  /**
   * Construct and simulate a open_payment_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Number of held payments `vasp` currently has open.
   */
  open_payment_count: ({vasp}: {vasp: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a submit_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Originating VASP records the hash of the IVMS101 payload it sent to
   * the beneficiary VASP off-chain.
   */
  submit_attestation: ({payment_id, attestation_hash, ivms_version}: {payment_id: u64, attestation_hash: Buffer, ivms_version: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_admin_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current admin withdraws the pending proposal.
   */
  cancel_admin_proposal: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_max_open_per_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_max_open_per_vasp: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a list_payments_by_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payments involving `vasp` (as originator or beneficiary side), in
   * submission order, starting at position `start` of that VASP's index.
   * `limit` is capped at `MAX_PAGE_SIZE`.
   */
  list_payments_by_vasp: ({vasp, start, limit}: {vasp: string, start: u64, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<Payment>>>

  /**
   * Construct and simulate a set_max_open_per_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Maximum number of held (pending) payments one originating VASP may have
   * open at once. Must be at least 1.
   */
  set_max_open_per_vasp: ({limit}: {limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a acknowledge_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Beneficiary VASP confirms it has checked the IVMS101 payload against
   * the attested hash. Release by the beneficiary requires this step.
   */
  acknowledge_attestation: ({payment_id}: {payment_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a refund_pending_for_vasp transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin refunds pending payments addressed to an inactive VASP, scanning
   * payment ids `start_id..start_id + limit` (bounded by `MAX_REFUND_BATCH`).
   * Returns the next id to resume from, or `payment_count` when finished.
   */
  refund_pending_for_vasp: ({vasp, start_id, limit}: {vasp: string, start_id: u64, limit: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a find_payment_by_attestation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The payment that first recorded `attestation_hash`, if any. Lets a VASP
   * that holds an IVMS101 payload find the payment it belongs to.
   */
  find_payment_by_attestation: ({attestation_hash}: {attestation_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u64>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, threshold_admin, payment_ttl}: {admin: string, threshold_admin: string, payment_ttl: Option<u64>},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, threshold_admin, payment_ttl}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAJgAAAHlSZXRpcmVkIChjb2RlIDEgaXMgcmVzZXJ2ZWQgYW5kIG11c3QgbmV2ZXIgYmUgcmV1c2VkKS4gU2V0dXAgbW92ZWQgdG8KdGhlIGNvbnN0cnVjdG9yLCBzbyB0aGlzIGNhbiBubyBsb25nZXIgYmUgcmV0dXJuZWQuAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAQAAAElPbmx5IHJldHVybmVkIGlmIHRoZSBjb25zdHJ1Y3RvciBuZXZlciByYW4uIFVucmVhY2hhYmxlIGFmdGVyIGRlcGxveW1lbnQuAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAACAAAAAAAAABVWYXNwQWxyZWFkeVJlZ2lzdGVyZWQAAAAAAAADAAAAAAAAAAxWYXNwTm90Rm91bmQAAAAEAAAAAAAAAA1WYXNwTm90QWN0aXZlAAAAAAAABQAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAYAAAAAAAAAD1BheW1lbnROb3RGb3VuZAAAAAAHAAAAAAAAABFQYXltZW50Tm90UGVuZGluZwAAAAAAAAgAAAAAAAAAE0F0dGVzdGF0aW9uUmVxdWlyZWQAAAAACQAAAAAAAAAbQXR0ZXN0YXRpb25BbHJlYWR5U3VibWl0dGVkAAAAAAoAAAAAAAAADFVuYXV0aG9yaXplZAAAAAsAAAAAAAAAEVBheW1lbnROb3RFeHBpcmVkAAAAAAAADAAAAHJUaGUgcGF5bWVudCdzIGBleHBpcmVzX2F0YCBoYXMgcGFzc2VkOiBpdCBjYW4gbm8gbG9uZ2VyIGJlIGF0dGVzdGVkCm9yIHJlbGVhc2VkLCBvbmx5IHJlY2xhaW1lZCBieSB0aGUgb3JpZ2luYXRvci4AAAAAAA5QYXltZW50RXhwaXJlZAAAAAAAJAAAAGdUaGUgY29udHJhY3QgcmVjZWl2ZWQgYSBkaWZmZXJlbnQgYW1vdW50IHRoYW4gdGhlIG9uZSByZXF1ZXN0ZWQsCmUuZy4gdGhlIHRva2VuIGNoYXJnZXMgYSB0cmFuc2ZlciBmZWUuAAAAABZSZWNlaXZlZEFtb3VudE1pc21hdGNoAAAAAAAgAAAANVRoZSBhc3NldCBpcyBub3Qgb24gdGhlIGFkbWluJ3MgYWxsb3dsaXN0IGZvciBlc2Nyb3cuAAAAAAAAD0Fzc2V0Tm90QWxsb3dlZAAAAAAhAAAAQ05ldyBwYXltZW50cyBhbmQgcmVsZWFzZXMgYXJlIGJsb2NrZWQgd2hpbGUgdGhlIGNvbnRyYWN0IGlzIHBhdXNlZC4AAAAABlBhdXNlZAAAAAAAIgAAADxSZXF1ZXN0ZWQgVFRMIGlzIG91dHNpZGUgW01JTl9QQVlNRU5UX1RUTCwgTUFYX1BBWU1FTlRfVFRMXS4AAAAKSW52YWxpZFR0bAAAAAAAIwAAACJgbm93ICsgdHRsYCBkb2VzIG5vdCBmaXQgaW4gYSB1NjQuAAAAAAAORXhwaXJ5T3ZlcmZsb3cAAAAAACYAAABOYGFjY2VwdF9hZG1pbmAgb3IgYGNhbmNlbF9hZG1pbl9wcm9wb3NhbGAgd2FzIGNhbGxlZCB3aXRoIG5vIHByb3Bvc2FsIHBlbmRpbmcuAAAAAAAOTm9QZW5kaW5nQWRtaW4AAAAAACUAAAAAAAAACFNhbWVWYXNwAAAADQAAAAAAAAAQSW52YWxpZFRocmVzaG9sZAAAAA4AAAA6QSByZXZva2VkIFZBU1AgaXMgdGVybWluYWwgYW5kIGNhbm5vdCBjaGFuZ2Ugc3RhdHVzIGFnYWluLgAAAAAAC1Zhc3BSZXZva2VkAAAAAA8AAAA6U3VzcGVuZGluZyBvciByZXZva2luZyBhIFZBU1AgcmVxdWlyZXMgYSBub24tZW1wdHkgcmVhc29uLgAAAAAADlJlYXNvblJlcXVpcmVkAAAAAAAQAAAAJlJlYXNvbiBleGNlZWRzIGBNQVhfUkVBU09OX0xFTmAgYnl0ZXMuAAAAAAANUmVhc29uVG9vTG9uZwAAAAAAABEAAABDQSBzdXBwbGllZCB2YWx1ZSBpcyBtYWxmb3JtZWQsIGUuZy4gYW4gZXhwaXJ5IHRoYXQgaXMgYWxyZWFkeSBwYXN0LgAAAAAMSW52YWxpZElucHV0AAAAEgAAAENgcmVtb3ZlX3RocmVzaG9sZGAgd2FzIGNhbGxlZCBmb3IgYSBqdXJpc2RpY3Rpb24gd2l0aCBubyB0aHJlc2hvbGQuAAAAABFUaHJlc2hvbGROb3RGb3VuZAAAAAAAABMAAAAqSnVyaXNkaWN0aW9uIGNvZGUgaXMgbm90IG9uIHRoZSBhbGxvd2xpc3QuAAAAAAATVW5rbm93bkp1cmlzZGljdGlvbgAAAAAUAAAAgkp1cmlzZGljdGlvbiBpcyBlbXB0eSBvciB0aGUgYCIqImAgd2lsZGNhcmQsIHdoaWNoIGlzIHJlc2VydmVkIGZvcgp0aHJlc2hvbGQgZmFsbGJhY2sgcnVsZXMgYW5kIGNhbm5vdCBuYW1lIGEgVkFTUCdzIGp1cmlzZGljdGlvbi4AAAAAABNJbnZhbGlkSnVyaXNkaWN0aW9uAAAAABUAAABLVGhlIHJlY2VpdmluZyBWQVNQIGlzIHN0aWxsIGFjdGl2ZSwgc28gdGhlIG9yaWdpbmF0b3IgY2Fubm90IHJlY2xhaW0gZWFybHkuAAAAABNSZWNlaXZlclN0aWxsQWN0aXZlAAAAABYAAAAmQmF0Y2ggc2l6ZSBleGNlZWRzIGBNQVhfUkVGVU5EX0JBVENIYC4AAAAAAA1CYXRjaFRvb0xhcmdlAAAAAAAAFwAAAE5Ib2xkaW5nIHRoaXMgcGF5bWVudCB3b3VsZCBwdXNoIHRoZSBvcmlnaW5hdG9yJ3MgZXNjcm93IGV4cG9zdXJlIG92ZXIgaXRzIGNhcC4AAAAAABNFeHBvc3VyZUNhcEV4Y2VlZGVkAAAAABgAAAA9UGF5bWVudCBhbW91bnQgaXMgYmVsb3cgdGhlIGNvbmZpZ3VyZWQgbWluaW11bSBmb3IgdGhlIGFzc2V0LgAAAAAAAA5CZWxvd01pbkFtb3VudAAAAAAAGQAAADpCZW5lZmljaWFyeSBhY2tub3dsZWRnZW1lbnQgd2FzIHJlY29yZGVkIGZvciB0aGlzIHBheW1lbnQuAAAAAAATQWxyZWFkeUFja25vd2xlZGdlZAAAAAAaAAAAOFRoZSBwYXltZW50IGhhcyBubyBhdHRlc3RhdGlvbiBhbWVuZG1lbnQgdG8gYWNrbm93bGVkZ2UuAAAAGkF0dGVzdGF0aW9uTm90QWNrbm93bGVkZ2VkAAAAAAAbAAAATlBheW1lbnQgYWxyZWFkeSBoYXMgYW4gYXR0ZXN0YXRpb24sIHNvIHRoZSBvcmlnaW5hdG9yIGNhbiBubyBsb25nZXIgY2FuY2VsIGl0LgAAAAAAD0FscmVhZHlBdHRlc3RlZAAAAAAcAAAAfFRoZSB0b2tlbiB0cmFuc2ZlciBmYWlsZWQgKGluc3VmZmljaWVudCBiYWxhbmNlLCBtaXNzaW5nIHRydXN0bGluZSBvcgp0aGUgcmVjaXBpZW50IGlzIG5vdCBhdXRob3Jpc2VkIHRvIHJlY2VpdmUgdGhlIGFzc2V0KS4AAAAOVHJhbnNmZXJGYWlsZWQAAAAAAB0AAABKVGhlIG9yaWdpbmF0aW5nIFZBU1AgYWxyZWFkeSBoYXMgdGhlIG1heGltdW0gbnVtYmVyIG9mIGhlbGQgcGF5bWVudHMgb3Blbi4AAAAAABBPcGVuTGltaXRSZWFjaGVkAAAAHgAAAAAAAAAMSW52YWxpZExpbWl0AAAAHw==",
        "AAAAAQAAAAAAAAAAAAAAB1BheW1lbnQAAAAAEgAAAD9TZXQgd2hlbiBgdG9fdmFzcGAgY29uZmlybXMgaXQgaGFzIGNoZWNrZWQgdGhlIElWTVMxMDEgcGF5bG9hZC4AAAAAD2Fja25vd2xlZGdlZF9hdAAAAAPoAAAABgAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAVhc3NldAAAAAAAABMAAAAyc2hhMjU2IG9mIHRoZSBJVk1TMTAxIHBheWxvYWQgZXhjaGFuZ2VkIG9mZi1jaGFpbi4AAAAAABBhdHRlc3RhdGlvbl9oYXNoAAAD6AAAA+4AAAAgAAAAAAAAAAthdHRlc3RlZF9hdAAAAAPoAAAABgAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAEZMZWRnZXIgc2VxdWVuY2UgYXQgc3VibWlzc2lvbiwgZm9yIG9yZGVyaW5nIGV2ZW50cyBhZ2FpbnN0IHRoZSBsZWRnZXIuAAAAAAAOY3JlYXRlZF9sZWRnZXIAAAAAAAQAAAAAAAAACmV4cGlyZXNfYXQAAAAAAAYAAACNT3B0aW9uYWwgcmVmZXJlbmNlIGZyb20gdGhlIG9yaWdpbmF0b3IncyBvd24gc3lzdGVtIChlLmcuIGFuIGFuY2hvcidzCnRyYW5zZmVyIGlkKSwgc28gb24tY2hhaW4gcGF5bWVudHMgY2FuIGJlIG1hdGNoZWQgdG8gb2ZmLWNoYWluIHJlY29yZHMuAAAAAAAADGV4dGVybmFsX3JlZgAAA+gAAAPuAAAAIAAAAAAAAAAJZnJvbV92YXNwAAAAAAAAEwAAAAAAAAACaWQAAAAAAAYAAAAAAAAADGl2bXNfdmVyc2lvbgAAA+gAAAAQAAAAAAAAABRyZXF1aXJlc19hdHRlc3RhdGlvbgAAAAEAAAAAAAAAC3Jlc29sdmVkX2F0AAAAA+gAAAAGAAAAMUxlZGdlciBzZXF1ZW5jZSBhdCByZWxlYXNlLCByZWplY3Rpb24gb3IgcmVjbGFpbS4AAAAAAAAPcmVzb2x2ZWRfbGVkZ2VyAAAAA+gAAAAEAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAANUGF5bWVudFN0YXR1cwAAAAAAAAAAAAAHdG9fdmFzcAAAAAAT",
        "AAAABQAAAAAAAAAAAAAACFBhdXNlU2V0AAAAAQAAAAlwYXVzZV9zZXQAAAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAACVZhc3BFbnRyeQAAAAAAAAcAAAAAAAAACGFkZGVkX2F0AAAABgAAAAAAAAAHYWRkcmVzcwAAAAATAAAARE9wdGlvbmFsIHVuaXggdGltZXN0YW1wIGFmdGVyIHdoaWNoIHRoZSBWQVNQIGlzIHRyZWF0ZWQgYXMgaW5hY3RpdmUuAAAACmV4cGlyZXNfYXQAAAAAA+gAAAAGAAAAAAAAAAxqdXJpc2RpY3Rpb24AAAAQAAAAAAAAAARuYW1lAAAAEAAAAD1LZXkgdXNlZCBvZmYtY2hhaW4gdG8gZW5jcnlwdCBJVk1TMTAxIHBheWxvYWRzIGZvciB0aGlzIFZBU1AuAAAAAAAACnB1YmxpY19rZXkAAAAAA+4AAAAgAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAKVmFzcFN0YXR1cwAA",
        "AAAAAgAAAAAAAAAAAAAAClZhc3BTdGF0dXMAAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACVN1c3BlbmRlZAAAAAAAAAAAAAAAAAAAB1Jldm9rZWQA",
        "AAAABQAAAAAAAAAAAAAAC1Zhc3BVcGRhdGVkAAAAAAEAAAAIdmFzcF91cGQAAAAEAAAAAAAAAAdhZGRyZXNzAAAAABMAAAABAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAKVmFzcFN0YXR1cwAAAAAAAAAAAAAAAAAKZXhwaXJlc19hdAAAAAAD6AAAAAYAAAAAAAAANldoeSB0aGUgc3RhdHVzIGNoYW5nZWQuIEVtcHR5IGZvciBleHBpcnktb25seSB1cGRhdGVzLgAAAAAABnJlYXNvbgAAAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADFRocmVzaG9sZFNldAAAAAEAAAAHdGhyX3NldAAAAAAEAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAAAAAAAAxqdXJpc2RpY3Rpb24AAAAQAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAADxgdHJ1ZWAgd2hlbiB0aGUgZXhhY3QgcnVsZSB3YXMgcmVtb3ZlZCAoYGFtb3VudGAgaXMgdGhlbiAwKS4AAAAHcmVtb3ZlZAAAAAABAAAAAAAAAAI=",
        "AAAAAgAAAAAAAAAAAAAADVBheW1lbnRTdGF0dXMAAAAAAAAGAAAAAAAAADdIZWxkIGluIGVzY3Jvdywgd2FpdGluZyBmb3IgYXR0ZXN0YXRpb24gYW5kL29yIHJlbGVhc2UuAAAAAAdQZW5kaW5nAAAAAAAAAAB+QmVuZWZpY2lhcnkgaGFzIGFza2VkIHRoZSBvcmlnaW5hdG9yIGZvciBtb3JlIGluZm9ybWF0aW9uLiBUaGUKb3JpZ2luYXRvciBjYW4gYW1lbmQgdGhlIGF0dGVzdGF0aW9uIHRvIHJldHVybiBpdCB0byBgUGVuZGluZ2AuAAAAAAAHUXVlcmllZAAAAAAAAAAAAAAAAAhSZWxlYXNlZAAAAAAAAAAAAAAACFJlamVjdGVkAAAAAAAAACdFeHBpcmVkIGFuZCByZWZ1bmRlZCB0byB0aGUgb3JpZ2luYXRvci4AAAAACVJlY2xhaW1lZAAAAAAAAAAAAAA8V2l0aGRyYXduIGJ5IHRoZSBvcmlnaW5hdG9yIGJlZm9yZSBhdHRlc3RhdGlvbiBhbmQgcmVmdW5kZWQuAAAACUNhbmNlbGxlZAAAAA==",
        "AAAABQAAAAAAAAAAAAAADUFkbWluQWNjZXB0ZWQAAAAAAAABAAAAB2FkbV9hY2MAAAAAAgAAAAAAAAAIcHJldmlvdXMAAAATAAAAAAAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADUFkbWluUHJvcG9zZWQAAAAAAAABAAAACGFkbV9wcm9wAAAAAQAAAAAAAAAIcHJvcG9zZWQAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADVBheW1lbnRUdGxTZXQAAAAAAAABAAAAB3R0bF9zZXQAAAAAAgAAAAAAAAAHc2Vjb25kcwAAAAAGAAAAAAAAAIpMZWRnZXIgdGltZSBmcm9tIHdoaWNoIHRoZSBuZXcgVFRMIGFwcGxpZXMuIE9ubHkgcGF5bWVudHMgY3JlYXRlZCBhdApvciBhZnRlciB0aGlzIHRpbWUgdXNlIGl0OyBleGlzdGluZyBwYXltZW50cyBrZWVwIHRoZWlyIGBleHBpcmVzX2F0YC4AAAAAAAxhcHBsaWVzX2Zyb20AAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlBheW1lbnRRdWVyaWVkAAAAAAABAAAAB3BheV9xcnkAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAAAg==",
        "AAAABQAAALRFbWl0dGVkIG9uIGB2YXNwX3VwZGAgd2hlbiBhIFZBU1Agcm90YXRlcyBpdHMgZW5jcnlwdGlvbiBrZXkuIENhcnJpZXMKc2hhMjU2IGhhc2hlcyBvZiB0aGUgb2xkIGFuZCBuZXcga2V5cyBzbyB0aGUgYXVkaXQgbG9nIGNhbiBzaG93IHRoZSBjaGFuZ2UKd2l0aG91dCByZS1wdWJsaXNoaW5nIGtleSBtYXRlcmlhbC4AAAAAAAAADlZhc3BLZXlSb3RhdGVkAAAAAAABAAAACHZhc3BfdXBkAAAAAwAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAQAAAAAAAAAMb2xkX2tleV9oYXNoAAAD7gAAACAAAAAAAAAAAAAAAAxuZXdfa2V5X2hhc2gAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADlZhc3BSZWdpc3RlcmVkAAAAAAABAAAACHZhc3BfcmVnAAAAAgAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAQAAAAAAAAAManVyaXNkaWN0aW9uAAAAEAAAAAAAAAAC",
        "AAAAAQAAAAAAAAAAAAAAD1RocmVzaG9sZENoYW5nZQAAAAADAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACmNoYW5nZWRfYXQAAAAAAAYAAACDUGVyLXJ1bGUgc2VxdWVuY2UgbnVtYmVyLCBzdGFydGluZyBhdCAwIGFuZCBuZXZlciByZXNldC4gQSBqdW1wIGluCmBzZXFgIGJldHdlZW4gcmV0YWluZWQgZW50cmllcyBtZWFucyBvbGRlciBjaGFuZ2VzIHdlcmUgdHJpbW1lZC4AAAAAA3NlcQAAAAAG",
        "AAAABQAAAAAAAAAAAAAAD1BheW1lbnRSZWplY3RlZAAAAAABAAAAB3BheV9yZWoAAAAABgAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAAhE9wdGlvbmFsIHNoYTI1NiBvZiB0aGUgZXZpZGVuY2Ugc3VwcG9ydGluZyB0aGUgcmVqZWN0aW9uIChzZWUKYHJlamVjdF9wYXltZW50YCBmb3IgdGhlIGV4cGVjdGVkIGZvcm1hdCkuIGBOb25lYCBmb3IgZXhwaXJ5IHJlY2xhaW1zLgAAAA1ldmlkZW5jZV9oYXNoAAAAAAAD6AAAA+4AAAAgAAAAAAAAAAAAAAAPcmVzb2x2ZWRfbGVkZ2VyAAAAAAQAAAAAAAAAT0FkZHJlc3MgdGhhdCBwZXJmb3JtZWQgdGhlIHJlamVjdGlvbiAob3IgdGhlIG9yaWdpbmF0b3IgZm9yIGFuIGV4cGlyeQpyZWNsYWltKS4AAAAAAmJ5AAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD1BheW1lbnRSZWxlYXNlZAAAAAABAAAAB3BheV9yZWwAAAAABQAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAA9yZXNvbHZlZF9sZWRnZXIAAAAABAAAAAAAAACEQWRkcmVzcyB0aGF0IHBlcmZvcm1lZCB0aGUgcmVsZWFzZTogdGhlIGJlbmVmaWNpYXJ5IFZBU1AsIHRoZSBhZG1pbgpvdmVycmlkZSwgb3IgdGhlIG9yaWdpbmF0b3IgZm9yIGJlbG93LXRocmVzaG9sZCBhdXRvLXNldHRsZW1lbnQuAAAAAmJ5AAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEFBheW1lbnRDYW5jZWxsZWQAAAABAAAACHBheV9jYW5jAAAAAwAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEFBheW1lbnRSZWNsYWltZWQAAAABAAAACHBheV9yZWNsAAAAAgAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEFBheW1lbnRTdWJtaXR0ZWQAAAABAAAAB3BheV9zdWIAAAAACQAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAlmcm9tX3Zhc3AAAAAAAAATAAAAAAAAAAAAAAAHdG9fdmFzcAAAAAATAAAAAAAAAAAAAAALYmVuZWZpY2lhcnkAAAAAEwAAAAAAAAAAAAAADGV4dGVybmFsX3JlZgAAA+gAAAPuAAAAIAAAAAAAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAAFHJlcXVpcmVzX2F0dGVzdGF0aW9uAAAAAQAAAAAAAAAAAAAADmNyZWF0ZWRfbGVkZ2VyAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEUFzc2V0QWxsb3dsaXN0U2V0AAAAAAAAAQAAAAdhc3Rfc2V0AAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAAAAAAAB2FsbG93ZWQAAAAAAQAAAAAAAAAC",
        "AAAABQAAAIlFbWl0dGVkIHdoZW4gdGhlIG9yaWdpbmF0b3IgcmVwbGFjZXMgYW4gYXR0ZXN0YXRpb24gYmVmb3JlIGl0IGlzCmFja25vd2xlZGdlZC4gQ2FycmllcyBib3RoIGhhc2hlcyBzbyB0aGUgc3VwZXJzZWRlZCBvbmUgc3RheXMgYXVkaXRhYmxlLgAAAAAAAAAAAAASQXR0ZXN0YXRpb25BbWVuZGVkAAAAAAABAAAAB2F0dF9hbWQAAAAABAAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAhvbGRfaGFzaAAAA+4AAAAgAAAAAAAAAAAAAAAIbmV3X2hhc2gAAAPuAAAAIAAAAAAAAAAAAAAADGl2bXNfdmVyc2lvbgAAABAAAAAAAAAAAg==",
        "AAAABQAAAJRFbWl0dGVkIG9uIGB2YXNwX3VwZGAgd2hlbiBhIFZBU1AncyBsZWdhbCBuYW1lIG9yIGp1cmlzZGljdGlvbiBjaGFuZ2VzLgpDYXJyaWVzIGJvdGggdGhlIG9sZCBhbmQgbmV3IHZhbHVlcyBzbyB0aGUgYXVkaXQgbG9nIHNob3dzIHRoZSBleGFjdCBjaGFuZ2UuAAAAAAAAABNWYXNwTWV0YWRhdGFVcGRhdGVkAAAAAAEAAAAIdmFzcF91cGQAAAAFAAAAAAAAAAdhZGRyZXNzAAAAABMAAAABAAAAAAAAAAhvbGRfbmFtZQAAABAAAAAAAAAAAAAAAAhuZXdfbmFtZQAAABAAAAAAAAAAAAAAABBvbGRfanVyaXNkaWN0aW9uAAAAEAAAAAAAAAAAAAAAEG5ld19qdXJpc2RpY3Rpb24AAAAQAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAFEF0dGVzdGF0aW9uU3VibWl0dGVkAAAAAQAAAAdhdHRfc3ViAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAEaGFzaAAAA+4AAAAgAAAAAAAAAAAAAAAMaXZtc192ZXJzaW9uAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAF0F0dGVzdGF0aW9uQWNrbm93bGVkZ2VkAAAAAAEAAAAHYXR0X2FjawAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAAAmF0AAAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAINFbWl0dGVkIHdoZW4gdGhlIGFkbWluIHJlbGVhc2VzIGEgcGF5bWVudCB0aGUgYmVuZWZpY2lhcnkgVkFTUCBoYXMgbm90CmFja25vd2xlZGdlZC4gS2VlcHMgdGhlIG92ZXJyaWRlIHZpc2libGUgaW4gdGhlIGF1ZGl0IHRyYWlsLgAAAAAAAAAAGUFja25vd2xlZGdlbWVudE92ZXJyaWRkZW4AAAAAAAABAAAAB3BheV9vdnIAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAAIZ2V0X3Zhc3AAAAABAAAAAAAAAAdhZGRyZXNzAAAAABMAAAABAAAD6QAAB9AAAAAJVmFzcEVudHJ5AAAAAAAAAw==",
        "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAINVcCB0byBgbGltaXRgIChjYXBwZWQgYXQgYE1BWF9WQVNQX1BBR0VgKSByZWdpc3RlcmVkIFZBU1AgYWRkcmVzc2VzLApzdGFydGluZyBhdCBpbmRleCBgc3RhcnRgLiBSZXR1cm5zIGFuIGVtcHR5IGxpc3QgcGFzdCB0aGUgZW5kLgAAAAAKbGlzdF92YXNwcwAAAAAAAgAAAAAAAAAFc3RhcnQAAAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6gAAABM=",
        "AAAAAAAAAIlBZG1pbiBwYXVzZXMgb3IgcmVzdW1lcyBuZXcgcGF5bWVudHMgYW5kIHJlbGVhc2VzLiBgcmVqZWN0X3BheW1lbnRgCmFuZCBgcmVjbGFpbV9leHBpcmVkYCBzdGF5IGF2YWlsYWJsZSBzbyBmdW5kcyBjYW4gYWx3YXlzIGJlIHJldHVybmVkLgAAAAAAAApzZXRfcGF1c2VkAAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAEVOdW1iZXIgb2YgVkFTUHMgZXZlciByZWdpc3RlcmVkICh0aGUgdmFsaWQgYGxpc3RfdmFzcHNgIGluZGV4IHJhbmdlKS4AAAAAAAAKdmFzcF9jb3VudAAAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAALZ2V0X3BheW1lbnQAAAAAAQAAAAAAAAAKcGF5bWVudF9pZAAAAAAABgAAAAEAAAPpAAAH0AAAAAdQYXltZW50AAAAAAM=",
        "AAAAAAAAAAAAAAALcGF5bWVudF90dGwAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAaJDaGFuZ2UgYSBWQVNQJ3MgbGVnYWwgbmFtZSBhbmQvb3IganVyaXNkaWN0aW9uIChhZG1pbiBvbmx5KS4KCkp1cmlzZGljdGlvbiBkZWNpZGVzIHdoaWNoIHRocmVzaG9sZCBhcHBsaWVzLCBzbyB0aGUgY2hhbmdlIG9ubHkKYWZmZWN0cyBwYXltZW50cyBzdWJtaXR0ZWQgYWZ0ZXIgaXQuIEEgcGF5bWVudCdzIGByZXF1aXJlc19hdHRlc3RhdGlvbmAKaXMgZml4ZWQgd2hlbiBpdCBpcyBzdWJtaXR0ZWQsIHNvIHBlbmRpbmcgcGF5bWVudHMga2VlcCB0aGUganVyaXNkaWN0aW9uCnRoZXkgd2VyZSBzdWJtaXR0ZWQgdW5kZXI6IG5laXRoZXIgdGhlaXIgYXR0ZXN0YXRpb24gcmVxdWlyZW1lbnQgbm9yCnRoZWlyIHJlbGVhc2UgcGF0aCBjaGFuZ2VzLiBUaGUgb2xkIGFuZCBuZXcgdmFsdWVzIGFyZSBlbWl0dGVkIG9uCmB2YXNwX3VwZGAuAAAAAAALdXBkYXRlX3Zhc3AAAAAAAwAAAAAAAAAHYWRkcmVzcwAAAAATAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAManVyaXNkaWN0aW9uAAAAEAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAH9TdGVwIDI6IHRoZSBwcm9wb3NlZCBhZG1pbiBhY2NlcHRzLiBgY2FsbGVyYCBtdXN0IGJlIHRoZSBwcm9wb3NlZAphZGRyZXNzIGFuZCBtdXN0IHNpZ247IGFueSBvdGhlciBhZGRyZXNzIGdldHMgYFVuYXV0aG9yaXplZGAuAAAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAADxTdW0gb2YgYHZhc3BgJ3MgY3VycmVudGx5IGhlbGQgKHBlbmRpbmcpIGFtb3VudHMgaW4gYGFzc2V0YC4AAAAMZ2V0X2V4cG9zdXJlAAAAAgAAAAAAAAAEdmFzcAAAABMAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAIBQYXltZW50IGlkcyBjdXJyZW50bHkgaGVsZCBpbiBlc2Nyb3cgKGF3YWl0aW5nIGF0dGVzdGF0aW9uIGFuZC9vcgpyZWxlYXNlKSwgaW4gc3VibWlzc2lvbiBvcmRlci4gUGFnZWQgbGlrZSBgcGF5bWVudHNfZm9yX3Zhc3BgLgAAAAxsaXN0X3BlbmRpbmcAAAACAAAAAAAAAAVzdGFydAAAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAABg==",
        "AAAAAAAAAPdSdW5zIG9uY2UsIGF0b21pY2FsbHkgd2l0aCBkZXBsb3ltZW50LCBzbyBub2JvZHkgY2FuIGZyb250LXJ1biBzZXR1cC4KYGFkbWluYCBkb2VzIG5vdCBuZWVkIHRvIHNpZ246IHRoZSBkZXBsb3llciBjaG9vc2VzIGl0LgpgcGF5bWVudF90dGxgIGlzIGhvdyBsb25nIChzZWNvbmRzKSBhIGhlbGQgcGF5bWVudCBjYW4gd2FpdCBiZWZvcmUgdGhlCm9yaWdpbmF0b3IgbWF5IHJlY2xhaW0gaXQ7IHBhc3MgYE5vbmVgIGZvciA3IGRheXMuAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA90aHJlc2hvbGRfYWRtaW4AAAAAEwAAAAAAAAALcGF5bWVudF90dGwAAAAD6AAAAAYAAAAA",
        "AAAAAAAAAHhVbmtub3duIG9yIG1hbGZvcm1lZCBjb2RlcyByZWFkIHRoZSBgIioiYCBmYWxsYmFjaywgdGhlIHNhbWUgcnVsZSBhCnBheW1lbnQgZnJvbSBhbiB1bnJlY29nbmlzZWQganVyaXNkaWN0aW9uIHdvdWxkIGhpdC4AAAANZ2V0X3RocmVzaG9sZAAAAAAAAAIAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAManVyaXNkaWN0aW9uAAAAEAAAAAEAAAAL",
        "AAAAAAAAAIVQYXltZW50cyB3aXRoIGlkcyBgc3RhcnQuLnN0YXJ0K2xpbWl0YCwgYXNjZW5kaW5nLiBgbGltaXRgIGlzIGNhcHBlZCBhdApgTUFYX1BBR0VfU0laRWA7IGEgcGFnZSBwYXN0IHRoZSBlbmQgKG9yIGBsaW1pdGAgMCkgaXMgZW1wdHkuAAAAAAAADWxpc3RfcGF5bWVudHMAAAAAAAACAAAAAAAAAAVzdGFydAAAAAAAAAYAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAdQYXltZW50AA==",
        "AAAAAAAAAD9OdW1iZXIgb2YgcGF5bWVudHMgZXZlciBzdWJtaXR0ZWQgKGlkcyBhcmUgYDAuLnBheW1lbnRfY291bnRgKS4AAAAADXBheW1lbnRfY291bnQAAAAAAAAAAAAAAQAAAAY=",
        "AAAAAAAAADNUaGUgcHJvcG9zZWQgYWRtaW4gYXdhaXRpbmcgYGFjY2VwdF9hZG1pbmAsIGlmIGFueS4AAAAADXBlbmRpbmdfYWRtaW4AAAAAAAAAAAAAAQAAA+gAAAAT",
        "AAAAAAAAAIVTdGVwIDEgb2YgYSBoYW5kb3ZlcjogdGhlIGN1cnJlbnQgYWRtaW4gcHJvcG9zZXMgYG5ld19hZG1pbmAuIFJlcGxhY2VzCmFueSBlYXJsaWVyIHByb3Bvc2FsIGFuZCBjaGFuZ2VzIG5vdGhpbmcgdW50aWwgYGFjY2VwdF9hZG1pbmAuAAAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAALBCZW5lZmljaWFyeSBWQVNQIGFza3MgdGhlIG9yaWdpbmF0b3IgZm9yIG1vcmUgaW5mb3JtYXRpb24gYWJvdXQgYQpoZWxkIHBheW1lbnQuIE1vdmVzIGBQZW5kaW5nYCB0byBgUXVlcmllZGAuIE5vdCBwb3NzaWJsZSBvbmNlIHRoZQphdHRlc3RhdGlvbiBpcyBhY2tub3dsZWRnZWQ7IHJlamVjdCBpbnN0ZWFkLgAAAA1xdWVyeV9wYXltZW50AAAAAAAAAgAAAAAAAAAKcGF5bWVudF9pZAAAAAAABgAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAANcmVnaXN0ZXJfdmFzcAAAAAAAAAUAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAEbmFtZQAAABAAAAAAAAAADGp1cmlzZGljdGlvbgAAABAAAAAAAAAACnB1YmxpY19rZXkAAAAAA+4AAAAgAAAAAAAAAApleHBpcmVzX2F0AAAAAAPoAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAALlBbW91bnQgKGluIHRoZSBhc3NldCdzIHNtYWxsZXN0IHVuaXQpIGF0IG9yIGFib3ZlIHdoaWNoIGEgcGF5bWVudApvcmlnaW5hdGluZyBmcm9tIGBqdXJpc2RpY3Rpb25gIG5lZWRzIGFuIGF0dGVzdGF0aW9uLiBVc2UgYCIqImAgYXMgYQpmYWxsYmFjayBmb3IganVyaXNkaWN0aW9ucyB3aXRob3V0IHRoZWlyIG93biBydWxlLgAAAAAAAA1zZXRfdGhyZXNob2xkAAAAAAAAAwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAxqdXJpc2RpY3Rpb24AAAAQAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAKNPcmlnaW5hdGluZyBWQVNQIHdpdGhkcmF3cyBhIGhlbGQgcGF5bWVudCBiZWZvcmUgYW55IGF0dGVzdGF0aW9uIHdhcwpzdWJtaXR0ZWQuIEZ1bmRzIHJldHVybiB0byB0aGUgb3JpZ2luYXRvciBpbW1lZGlhdGVseSwgd2l0aG91dCB3YWl0aW5nCmZvciB0aGUgcmVjbGFpbSB3aW5kb3cuAAAAAA5jYW5jZWxfcGF5bWVudAAAAAAAAQAAAAAAAAAKcGF5bWVudF9pZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADRTbWFsbGVzdCBhY2NlcHRlZCBwYXltZW50IGluIGBhc3NldGAgKDAgd2hlbiB1bnNldCkuAAAADmdldF9taW5fYW1vdW50AAAAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAACw==",
        "AAAAAAAAADlUcnVlIGlmIHRoZSBWQVNQIGV4aXN0cywgaXMgYEFjdGl2ZWAgYW5kIGhhcyBub3QgZXhwaXJlZC4AAAAAAAAOaXNfdmFzcF9hY3RpdmUAAAAAAAEAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAEAAAAB",
        "AAAAAAAAAjtCZW5lZmljaWFyeSBWQVNQIG9yIGFkbWluIHJlamVjdHMgYSBoZWxkIHBheW1lbnQ7IGZ1bmRzIGdvIGJhY2sgdG8gdGhlCm9yaWdpbmF0aW5nIFZBU1AuIEFsbG93ZWQgd2hpbGUgYFBlbmRpbmdgIG9yIGBRdWVyaWVkYC4gYHJlYXNvbmAgaXMKZW1pdHRlZCBmb3IgdGhlIGF1ZGl0IHRyYWlsLgoKYGV2aWRlbmNlX2hhc2hgIGlzIG9wdGlvbmFsLiBXaGVuIGdpdmVuIGl0IG11c3QgYmUgdGhlIHNoYTI1NiBvZiB0aGUKZXZpZGVuY2UgZG9jdW1lbnQgdGhhdCBqdXN0aWZpZWQgdGhlIHJlamVjdGlvbiwgc2VyaWFsaXNlZCBhcyBVVEYtOApKU09OIGFuZCBleGNoYW5nZWQgb2ZmLWNoYWluIGJldHdlZW4gdGhlIFZBU1BzIGFuZCB0aGUgYWRtaW4uIE9ubHkgdGhlCmhhc2ggaXMgZW1pdHRlZCBpbiBgcGF5X3JlamA7IHRoZSBkb2N1bWVudCBpdHNlbGYsIGFuZCBhbnkgcGVyc29uYWwKZGF0YSBpbiBpdCwgbmV2ZXIgdG91Y2hlcyB0aGUgbGVkZ2VyLiBBbnlvbmUgcmVhZGluZyB0aGUgYXVkaXQgbG9nIGNhbgpjaGVjayBhIGRpc2Nsb3NlZCBkb2N1bWVudCBieSBoYXNoaW5nIGl0IGFuZCBjb21wYXJpbmcuAAAAAA5yZWplY3RfcGF5bWVudAAAAAAABAAAAAAAAAAKcGF5bWVudF9pZAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAZyZWFzb24AAAAAABAAAAAAAAAADWV2aWRlbmNlX2hhc2gAAAAAAAPoAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAHBBZG1pbiBzZXRzIHRoZSBzbWFsbGVzdCBwYXltZW50IGFjY2VwdGVkIGluIGBhc3NldGAuIGAwYCBkaXNhYmxlcyB0aGUKbWluaW11bSAoYW55IHBvc2l0aXZlIGFtb3VudCBpcyBhY2NlcHRlZCkuAAAADnNldF9taW5fYW1vdW50AAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAMhPcmlnaW5hdGluZyBWQVNQIHNlbmRzIGBhbW91bnRgIG9mIGBhc3NldGAgdG93YXJkcyBgYmVuZWZpY2lhcnlgIGF0CmB0b192YXNwYC4gVG9rZW5zIG1vdmUgaW50byBlc2Nyb3cuIEJlbG93LXRocmVzaG9sZCBwYXltZW50cyBzZXR0bGUgaW4KdGhlIHNhbWUgY2FsbDsgb3RoZXJzIHN0YXkgYFBlbmRpbmdgLiBSZXR1cm5zIHRoZSBwYXltZW50IGlkLgAAAA5zdWJtaXRfcGF5bWVudAAAAAAABgAAAAAAAAAJZnJvbV92YXNwAAAAAAAAEwAAAAAAAAAHdG9fdmFzcAAAAAATAAAAAAAAAAtiZW5lZmljaWFyeQAAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAMZXh0ZXJuYWxfcmVmAAAD6AAAA+4AAAAgAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAKVFdmVyeSBjb25maWd1cmVkIHJ1bGUgd2l0aCBhIG5vbi16ZXJvIGFtb3VudCwgYXMKYChhc3NldCwganVyaXNkaWN0aW9uLCBhbW91bnQpYC4gQSBydWxlIHNldCB0byAwIGlzIGRyb3BwZWQgZnJvbSB0aGlzCmxpc3QgYnV0IHN0aWxsIGFuc3dlcnMgYGdldF90aHJlc2hvbGRgIHdpdGggMC4AAAAAAAAPbGlzdF90aHJlc2hvbGRzAAAAAAAAAAABAAAD6gAAA+0AAAADAAAAEwAAABAAAAAL",
        "AAAAAAAAALFBZnRlciBgZXhwaXJlc19hdGAsIHRoZSBvcmlnaW5hdGluZyBWQVNQIGNhbiBwdWxsIGJhY2sgYSBwYXltZW50IHRoYXQKd2FzIG5ldmVyIHJlbGVhc2VkIG9yIHJlamVjdGVkLCBzbyBmdW5kcyBjYW4ndCBnZXQgc3R1Y2suIFRoaXMgYWxzbwphcHBsaWVzIHdoaWxlIHRoZSBwYXltZW50IGlzIGBRdWVyaWVkYC4AAAAAAAAPcmVjbGFpbV9leHBpcmVkAAAAAAEAAAAAAAAACnBheW1lbnRfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAANFCZW5lZmljaWFyeSBWQVNQIG9yIGFkbWluIHJlbGVhc2VzIGEgaGVsZCBwYXltZW50IHRvIHRoZSBiZW5lZmljaWFyeS4KVGhlIGJlbmVmaWNpYXJ5IG11c3QgaGF2ZSBhY2tub3dsZWRnZWQgdGhlIGF0dGVzdGF0aW9uIGZpcnN0LiBUaGUgYWRtaW4KbWF5IHJlbGVhc2Ugd2l0aG91dCBhY2tub3dsZWRnZW1lbnQ7IHRoYXQgb3ZlcnJpZGUgZW1pdHMgYHBheV9vdnJgLgAAAAAAAA9yZWxlYXNlX3BheW1lbnQAAAAAAgAAAAAAAAAKcGF5bWVudF9pZAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAMpSZXBsYWNlIGEgVkFTUCdzIGVuY3J5cHRpb24ga2V5IChhZG1pbiBvbmx5KS4gT25seSB0aGUga2V5IHVzZWQgdG8KZW5jcnlwdCBmdXR1cmUgSVZNUzEwMSBwYXlsb2FkcyBjaGFuZ2VzOiBwYXltZW50cyBhbHJlYWR5IGluIGZsaWdodAprZWVwIHRoZWlyIGZyb20vdG8gVkFTUCBhZGRyZXNzZXMsIGFtb3VudHMsIHN0YXR1cyBhbmQgYXR0ZXN0YXRpb24uAAAAAAAPcm90YXRlX3Zhc3Bfa2V5AAAAAAIAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAHbmV3X2tleQAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAINBZG1pbiBzZXRzIGhvdyBsb25nIGEgaGVsZCBwYXltZW50IG1heSB3YWl0IGJlZm9yZSB0aGUgb3JpZ2luYXRvciBjYW4KcmVjbGFpbSBpdC4gQXBwbGllcyBvbmx5IHRvIHBheW1lbnRzIGNyZWF0ZWQgYWZ0ZXIgdGhpcyBjYWxsLgAAAAAPc2V0X3BheW1lbnRfdHRsAAAAAAEAAAAAAAAAB3NlY29uZHMAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAPc2V0X3Zhc3BfZXhwaXJ5AAAAAAIAAAAAAAAAB2FkZHJlc3MAAAAAEwAAAAAAAAAKZXhwaXJlc19hdAAAAAAD6AAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAALdTZXRzIGEgVkFTUCdzIHN0YXR1cy4gU3VzcGVuZGluZyBvciByZXZva2luZyByZXF1aXJlcyBhIG5vbi1lbXB0eQpgcmVhc29uYDsgYW55IHJlYXNvbiBpcyBjYXBwZWQgYXQgYE1BWF9SRUFTT05fTEVOYCBieXRlcy4gVGhlIHJlYXNvbiBpcwplbWl0dGVkIGluIGBWYXNwVXBkYXRlZGAgZm9yIHRoZSBhdWRpdCB0cmFpbC4AAAAAD3NldF92YXNwX3N0YXR1cwAAAAADAAAAAAAAAAdhZGRyZXNzAAAAABMAAAAAAAAABnN0YXR1cwAAAAAH0AAAAApWYXNwU3RhdHVzAAAAAAAAAAAABnJlYXNvbgAAAAAAEAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADtDdXJyZW50IGNhcCBmb3IgYHZhc3BgIGluIGBhc3NldGAsIG9yIGBOb25lYCB3aGVuIHVuY2FwcGVkLgAAAAAQZ2V0X2V4cG9zdXJlX2NhcAAAAAIAAAAAAAAABHZhc3AAAAATAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAD6AAAAAs=",
        "AAAAAAAAAAAAAAAQaXNfYXNzZXRfYWxsb3dlZAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAAB",
        "AAAAAAAAAKZPcmlnaW5hdGluZyBWQVNQIHJlY2xhaW1zIGEgaGVsZCBwYXltZW50IGltbWVkaWF0ZWx5IHdoZW4gdGhlCnJlY2VpdmluZyBWQVNQIGlzIG5vIGxvbmdlciBhY3RpdmUgKHJldm9rZWQsIHN1c3BlbmRlZCBvciBleHBpcmVkKSwKaW5zdGVhZCBvZiB3YWl0aW5nIGZvciBgZXhwaXJlc19hdGAuAAAAAAAQcmVjbGFpbV9pbmFjdGl2ZQAAAAEAAAAAAAAACnBheW1lbnRfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAALZEZWxldGVzIHRoZSBleGFjdCBgKGFzc2V0LCBqdXJpc2RpY3Rpb24pYCBydWxlIHNvIHRoZSBgIioiYCBmYWxsYmFjawphcHBsaWVzIHRvIHRoYXQganVyaXNkaWN0aW9uIGFnYWluLiBGYWlscyB3aXRoIGBUaHJlc2hvbGROb3RGb3VuZGAgaWYgbm8KcnVsZSBpcyBzZXQgZm9yIHRoYXQgZXhhY3QganVyaXNkaWN0aW9uLgAAAAAAEHJlbW92ZV90aHJlc2hvbGQAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAADGp1cmlzZGljdGlvbgAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAJ5DYXBzIHRoZSB0b3RhbCB2YWx1ZSBgdmFzcGAgbWF5IGhvbGQgaW4gZXNjcm93IGluIGBhc3NldGAgYXQgb25jZS4KT25seSBoZWxkIChhdHRlc3RhdGlvbi1yZXF1aXJlZCkgcGF5bWVudHMgY291bnQuIFdpdGhvdXQgYSBjYXAgdGhlCm9yaWdpbmF0b3IgaXMgdW5saW1pdGVkLgAAAAAAEHNldF9leHBvc3VyZV9jYXAAAAADAAAAAAAAAAR2YXNwAAAAEwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAMtPcmlnaW5hdGluZyBWQVNQIHJlcGxhY2VzIHRoZSBhdHRlc3RhdGlvbiBvZiBhIGhlbGQgcGF5bWVudCwgZm9yCmV4YW1wbGUgdG8gc2VuZCBhIGNvcnJlY3RlZCBJVk1TMTAxIHBheWxvYWQuIEFsbG93ZWQgb25seSB1bnRpbCB0aGUKYmVuZWZpY2lhcnkgYWNrbm93bGVkZ2VzLiBUaGUgc3VwZXJzZWRlZCBoYXNoIGlzIGVtaXR0ZWQgaW4gYGF0dF9hbWRgLgAAAAARYW1lbmRfYXR0ZXN0YXRpb24AAAAAAAADAAAAAAAAAApwYXltZW50X2lkAAAAAAAGAAAAAAAAABBhdHRlc3RhdGlvbl9oYXNoAAAD7gAAACAAAAAAAAAADGl2bXNfdmVyc2lvbgAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAM5QYXltZW50IGlkcyBpbiB3aGljaCBgdmFzcGAgaXMgZWl0aGVyIG9yaWdpbmF0b3Igb3IgYmVuZWZpY2lhcnksIGluCnN1Ym1pc3Npb24gb3JkZXIuIFJldHVybnMgYXQgbW9zdCBgbWluKGxpbWl0LCBNQVhfUEFHRV9TSVpFKWAgaWRzCnN0YXJ0aW5nIGF0IG9mZnNldCBgc3RhcnRgOyBhbiBvdXQtb2YtcmFuZ2UgYHN0YXJ0YCB5aWVsZHMgYW4gZW1wdHkgVmVjLgAAAAAAEXBheW1lbnRzX2Zvcl92YXNwAAAAAAAAAwAAAAAAAAAEdmFzcAAAABMAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAAG",
        "AAAAAAAAAGpBZG1pbiBhZGRzIG9yIHJlbW92ZXMgYGFzc2V0YCBmcm9tIHRoZSBzZXQgdGhhdCBtYXkgYmUgZXNjcm93ZWQuClBheW1lbnRzIGluIGFueSBvdGhlciBhc3NldCBhcmUgcmVqZWN0ZWQuAAAAAAARc2V0X2Fzc2V0X2FsbG93ZWQAAAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAB2FsbG93ZWQAAAAAAQAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAANZDaGFuZ2Vsb2cgZm9yIG9uZSBgKGFzc2V0LCBqdXJpc2RpY3Rpb24pYCBydWxlLCBvbGRlc3QgZmlyc3QuIFJldHVybnMgdXAKdG8gYGxpbWl0YCBlbnRyaWVzIChjYXBwZWQgYXQgYE1BWF9USFJFU0hPTERfSElTVE9SWWApIHN0YXJ0aW5nIGF0IGluZGV4CmBzdGFydGAgb2YgdGhlIHJldGFpbmVkIGhpc3RvcnkuIFBhc3QgdGhlIGVuZCByZXR1cm5zIGFuIGVtcHR5IGxpc3QuAAAAAAARdGhyZXNob2xkX2hpc3RvcnkAAAAAAAAEAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAADGp1cmlzZGljdGlvbgAAABAAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAfQAAAAD1RocmVzaG9sZENoYW5nZQA=",
        "AAAAAAAAADJOdW1iZXIgb2YgaGVsZCBwYXltZW50cyBgdmFzcGAgY3VycmVudGx5IGhhcyBvcGVuLgAAAAAAEm9wZW5fcGF5bWVudF9jb3VudAAAAAAAAQAAAAAAAAAEdmFzcAAAABMAAAABAAAABA==",
        "AAAAAAAAAGNPcmlnaW5hdGluZyBWQVNQIHJlY29yZHMgdGhlIGhhc2ggb2YgdGhlIElWTVMxMDEgcGF5bG9hZCBpdCBzZW50IHRvCnRoZSBiZW5lZmljaWFyeSBWQVNQIG9mZi1jaGFpbi4AAAAAEnN1Ym1pdF9hdHRlc3RhdGlvbgAAAAAAAwAAAAAAAAAKcGF5bWVudF9pZAAAAAAABgAAAAAAAAAQYXR0ZXN0YXRpb25faGFzaAAAA+4AAAAgAAAAAAAAAAxpdm1zX3ZlcnNpb24AAAAQAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAC1DdXJyZW50IGFkbWluIHdpdGhkcmF3cyB0aGUgcGVuZGluZyBwcm9wb3NhbC4AAAAAAAAVY2FuY2VsX2FkbWluX3Byb3Bvc2FsAAAAAAAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAVZ2V0X21heF9vcGVuX3Blcl92YXNwAAAAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAKxQYXltZW50cyBpbnZvbHZpbmcgYHZhc3BgIChhcyBvcmlnaW5hdG9yIG9yIGJlbmVmaWNpYXJ5IHNpZGUpLCBpbgpzdWJtaXNzaW9uIG9yZGVyLCBzdGFydGluZyBhdCBwb3NpdGlvbiBgc3RhcnRgIG9mIHRoYXQgVkFTUCdzIGluZGV4LgpgbGltaXRgIGlzIGNhcHBlZCBhdCBgTUFYX1BBR0VfU0laRWAuAAAAFWxpc3RfcGF5bWVudHNfYnlfdmFzcAAAAAAAAAMAAAAAAAAABHZhc3AAAAATAAAAAAAAAAVzdGFydAAAAAAAAAYAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAdQYXltZW50AA==",
        "AAAAAAAAAGlNYXhpbXVtIG51bWJlciBvZiBoZWxkIChwZW5kaW5nKSBwYXltZW50cyBvbmUgb3JpZ2luYXRpbmcgVkFTUCBtYXkgaGF2ZQpvcGVuIGF0IG9uY2UuIE11c3QgYmUgYXQgbGVhc3QgMS4AAAAAAAAVc2V0X21heF9vcGVuX3Blcl92YXNwAAAAAAAAAQAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAIZCZW5lZmljaWFyeSBWQVNQIGNvbmZpcm1zIGl0IGhhcyBjaGVja2VkIHRoZSBJVk1TMTAxIHBheWxvYWQgYWdhaW5zdAp0aGUgYXR0ZXN0ZWQgaGFzaC4gUmVsZWFzZSBieSB0aGUgYmVuZWZpY2lhcnkgcmVxdWlyZXMgdGhpcyBzdGVwLgAAAAAAF2Fja25vd2xlZGdlX2F0dGVzdGF0aW9uAAAAAAEAAAAAAAAACnBheW1lbnRfaWQAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAANZBZG1pbiByZWZ1bmRzIHBlbmRpbmcgcGF5bWVudHMgYWRkcmVzc2VkIHRvIGFuIGluYWN0aXZlIFZBU1AsIHNjYW5uaW5nCnBheW1lbnQgaWRzIGBzdGFydF9pZC4uc3RhcnRfaWQgKyBsaW1pdGAgKGJvdW5kZWQgYnkgYE1BWF9SRUZVTkRfQkFUQ0hgKS4KUmV0dXJucyB0aGUgbmV4dCBpZCB0byByZXN1bWUgZnJvbSwgb3IgYHBheW1lbnRfY291bnRgIHdoZW4gZmluaXNoZWQuAAAAAAAXcmVmdW5kX3BlbmRpbmdfZm9yX3Zhc3AAAAAAAwAAAAAAAAAEdmFzcAAAABMAAAAAAAAACHN0YXJ0X2lkAAAABgAAAAAAAAAFbGltaXQAAAAAAAAGAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAIVUaGUgcGF5bWVudCB0aGF0IGZpcnN0IHJlY29yZGVkIGBhdHRlc3RhdGlvbl9oYXNoYCwgaWYgYW55LiBMZXRzIGEgVkFTUAp0aGF0IGhvbGRzIGFuIElWTVMxMDEgcGF5bG9hZCBmaW5kIHRoZSBwYXltZW50IGl0IGJlbG9uZ3MgdG8uAAAAAAAAG2ZpbmRfcGF5bWVudF9ieV9hdHRlc3RhdGlvbgAAAAABAAAAAAAAABBhdHRlc3RhdGlvbl9oYXNoAAAD7gAAACAAAAABAAAD6AAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    admin: this.txFromJSON<Result<string>>,
        get_vasp: this.txFromJSON<Result<VaspEntry>>,
        is_paused: this.txFromJSON<boolean>,
        list_vasps: this.txFromJSON<Array<string>>,
        set_paused: this.txFromJSON<Result<void>>,
        vasp_count: this.txFromJSON<u32>,
        get_payment: this.txFromJSON<Result<Payment>>,
        payment_ttl: this.txFromJSON<u64>,
        update_vasp: this.txFromJSON<Result<void>>,
        accept_admin: this.txFromJSON<Result<void>>,
        get_exposure: this.txFromJSON<i128>,
        list_pending: this.txFromJSON<Array<u64>>,
        get_threshold: this.txFromJSON<i128>,
        list_payments: this.txFromJSON<Array<Payment>>,
        payment_count: this.txFromJSON<u64>,
        pending_admin: this.txFromJSON<Option<string>>,
        propose_admin: this.txFromJSON<Result<void>>,
        query_payment: this.txFromJSON<Result<void>>,
        register_vasp: this.txFromJSON<Result<void>>,
        set_threshold: this.txFromJSON<Result<void>>,
        cancel_payment: this.txFromJSON<Result<void>>,
        get_min_amount: this.txFromJSON<i128>,
        is_vasp_active: this.txFromJSON<boolean>,
        reject_payment: this.txFromJSON<Result<void>>,
        set_min_amount: this.txFromJSON<Result<void>>,
        submit_payment: this.txFromJSON<Result<u64>>,
        list_thresholds: this.txFromJSON<Array<readonly [string, string, i128]>>,
        reclaim_expired: this.txFromJSON<Result<void>>,
        release_payment: this.txFromJSON<Result<void>>,
        rotate_vasp_key: this.txFromJSON<Result<void>>,
        set_payment_ttl: this.txFromJSON<Result<void>>,
        set_vasp_expiry: this.txFromJSON<Result<void>>,
        set_vasp_status: this.txFromJSON<Result<void>>,
        get_exposure_cap: this.txFromJSON<Option<i128>>,
        is_asset_allowed: this.txFromJSON<boolean>,
        reclaim_inactive: this.txFromJSON<Result<void>>,
        remove_threshold: this.txFromJSON<Result<void>>,
        set_exposure_cap: this.txFromJSON<Result<void>>,
        amend_attestation: this.txFromJSON<Result<void>>,
        payments_for_vasp: this.txFromJSON<Array<u64>>,
        set_asset_allowed: this.txFromJSON<Result<void>>,
        threshold_history: this.txFromJSON<Array<ThresholdChange>>,
        open_payment_count: this.txFromJSON<u32>,
        submit_attestation: this.txFromJSON<Result<void>>,
        cancel_admin_proposal: this.txFromJSON<Result<void>>,
        get_max_open_per_vasp: this.txFromJSON<u32>,
        list_payments_by_vasp: this.txFromJSON<Array<Payment>>,
        set_max_open_per_vasp: this.txFromJSON<Result<void>>,
        acknowledge_attestation: this.txFromJSON<Result<void>>,
        refund_pending_for_vasp: this.txFromJSON<Result<u64>>,
        find_payment_by_attestation: this.txFromJSON<Option<u64>>
  }
}