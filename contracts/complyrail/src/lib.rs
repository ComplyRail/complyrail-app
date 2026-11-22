#![no_std]
//! # ComplyRail
//!
//! On-chain FATF Travel Rule enforcement for Stellar anchors.
//!
//! The contract combines four pieces:
//!
//! * **VASP registry** – the admin registers Virtual Asset Service Providers,
//!   and can suspend, revoke or re-activate them. Entries can expire.
//! * **Thresholds** – per `(asset, jurisdiction)` amount above which a
//!   payment needs a Travel Rule attestation before it settles.
//! * **Escrow** – `submit_payment` pulls tokens from the originating VASP
//!   into the contract. Payments below the threshold settle immediately;
//!   payments at or above it are held until an attestation is supplied and
//!   the beneficiary VASP (or admin) releases them.
//! * **Attestations** – the originating VASP submits a 32-byte hash of the
//!   IVMS101 payload exchanged off-chain, plus the IVMS101 version string.
//!   Personal data never touches the ledger, only its hash.
//!
//! Two roles: the **admin** runs the VASP registry and the **threshold admin**
//! sets Travel Rule thresholds, so one compromised key cannot do both.
//!
//! Every state change emits an event whose topic matches the dashboard's
//! audit log types (`vasp_reg`, `vasp_upd`, `thr_set`, `admin_chg`, `pay_sub`,
//! `att_sub`, `pay_rel`, `pay_rej`, `pay_canc`).

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Bytes, BytesN,
    Env, String, Vec,
};

mod jurisdictions;
mod test;

/// Default time (seconds) a held payment may wait for release before the
/// originator can reclaim it: 7 days.
pub const DEFAULT_PAYMENT_TTL: u64 = 7 * 24 * 60 * 60;

/// Default cap on held (pending) payments an originating VASP may have open at
/// once. Admin can change it with `set_max_open_per_vasp`.
pub const DEFAULT_MAX_OPEN_PER_VASP: u32 = 100;

/// Largest amount a threshold may hold: the maximum supply of a classic
/// Stellar asset, `i64::MAX` stroops. Soroban token interfaces expose no
/// standard total-supply getter, so this is the bound used for every asset.
/// A threshold above it could never be compared meaningfully against a payment.
pub const MAX_THRESHOLD: i128 = i64::MAX as i128;

/// Most recent threshold changes kept per `(asset, jurisdiction)` rule.
/// Older entries are dropped; `ThresholdChange::seq` shows any gap.
pub const MAX_THRESHOLD_HISTORY: u32 = 100;

/// Upper bound on entries returned by one `list_vasps` call.
pub const MAX_VASP_PAGE: u32 = 100;

/// Upper bound on how many payment ids one `refund_pending_for_vasp` call scans.
pub const MAX_REFUND_BATCH: u64 = 100;

/// Upper bound on the number of ids a single `payments_for_vasp` call returns.
pub const MAX_PAGE_SIZE: u32 = 100;

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Retired (code 1 is reserved and must never be reused). Setup moved to
    /// the constructor, so this can no longer be returned.
    AlreadyInitialized = 1,
    /// Only returned if the constructor never ran. Unreachable after deployment.
    NotInitialized = 2,
    VaspAlreadyRegistered = 3,
    VaspNotFound = 4,
    VaspNotActive = 5,
    InvalidAmount = 6,
    PaymentNotFound = 7,
    PaymentNotPending = 8,
    AttestationRequired = 9,
    AttestationAlreadySubmitted = 10,
    Unauthorized = 11,
    PaymentNotExpired = 12,
    SameVasp = 13,
    InvalidThreshold = 14,
    /// A revoked VASP is terminal and cannot change status again.
    VaspRevoked = 15,
    /// Suspending or revoking a VASP requires a non-empty reason.
    ReasonRequired = 16,
    /// Reason exceeds `MAX_REASON_LEN` bytes.
    ReasonTooLong = 17,
    /// A supplied value is malformed, e.g. an expiry that is already past.
    InvalidInput = 18,
    /// `remove_threshold` was called for a jurisdiction with no threshold.
    ThresholdNotFound = 19,
    /// Jurisdiction code is not on the allowlist.
    UnknownJurisdiction = 20,
    /// Jurisdiction is empty or the `"*"` wildcard, which is reserved for
    /// threshold fallback rules and cannot name a VASP's jurisdiction.
    InvalidJurisdiction = 21,
    /// The receiving VASP is still active, so the originator cannot reclaim early.
    ReceiverStillActive = 22,
    /// Batch size exceeds `MAX_REFUND_BATCH`.
    BatchTooLarge = 23,
    /// Holding this payment would push the originator's escrow exposure over its cap.
    ExposureCapExceeded = 24,
    /// Payment amount is below the configured minimum for the asset.
    BelowMinAmount = 25,
    /// Beneficiary acknowledgement was recorded for this payment.
    AlreadyAcknowledged = 26,
    /// The payment has no attestation amendment to acknowledge.
    AttestationNotAcknowledged = 27,
    /// Payment already has an attestation, so the originator can no longer cancel it.
    AlreadyAttested = 28,
    /// The token transfer failed (insufficient balance, missing trustline or
    /// the recipient is not authorised to receive the asset).
    TransferFailed = 29,
    /// The originating VASP already has the maximum number of held payments open.
    OpenLimitReached = 30,
    InvalidLimit = 31,
}

/// Upper bound on the reason attached to a status change, in bytes.
pub const MAX_REASON_LEN: u32 = 256;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VaspStatus {
    Active,
    Suspended,
    Revoked,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaymentStatus {
    /// Held in escrow, waiting for attestation and/or release.
    Pending,
    /// Beneficiary has asked the originator for more information. The
    /// originator can amend the attestation to return it to `Pending`.
    Queried,
    Released,
    Rejected,
    /// Expired and refunded to the originator.
    Reclaimed,
    /// Withdrawn by the originator before attestation and refunded.
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaspEntry {
    pub address: Address,
    pub name: String,
    pub jurisdiction: String,
    /// Key used off-chain to encrypt IVMS101 payloads for this VASP.
    pub public_key: BytesN<32>,
    pub status: VaspStatus,
    pub added_at: u64,
    /// Optional unix timestamp after which the VASP is treated as inactive.
    pub expires_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdChange {
    /// Per-rule sequence number, starting at 0 and never reset. A jump in
    /// `seq` between retained entries means older changes were trimmed.
    pub seq: u64,
    pub amount: i128,
    pub changed_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payment {
    pub id: u64,
    pub from_vasp: Address,
    pub to_vasp: Address,
    pub beneficiary: Address,
    pub asset: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub requires_attestation: bool,
    /// sha256 of the IVMS101 payload exchanged off-chain.
    pub attestation_hash: Option<BytesN<32>>,
    pub ivms_version: Option<String>,
    pub attested_at: Option<u64>,
    /// Set when `to_vasp` confirms it has checked the IVMS101 payload.
    pub acknowledged_at: Option<u64>,
    pub created_at: u64,
    /// Ledger sequence at submission, for ordering events against the ledger.
    pub created_ledger: u32,
    pub expires_at: u64,
    pub resolved_at: Option<u64>,
    /// Ledger sequence at release, rejection or reclaim.
    pub resolved_ledger: Option<u32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    ThresholdAdmin,
    PaymentTtl,
    NextPaymentId,
    /// Number of registered VASPs; also the next free index.
    VaspCount,
    /// Registered VASP address at position `index` (one persistent entry each).
    VaspAt(u32),
    Vasp(Address),
    Threshold(Address, String),
    ThresholdHistory(Address, String),
    Payment(u64),
    MaxOpenPerVasp,
    OpenCount(Address),
    /// Ids of every payment this VASP originated or is the recipient of, in
    /// submission order.
    VaspPayments(Address),
    /// Ids of payments currently held in escrow, in submission order.
    PendingPayments,
    /// Reverse lookup from an attestation hash to the payment that first
    /// recorded it.
    AttestationOwner(BytesN<32>),
    /// Per-(originator, asset) cap on value held in escrow.
    ExposureCap(Address, Address),
    /// Smallest payment accepted for an asset.
    MinAmount(Address),
    /// Per-(originator, asset) sum of currently held (pending) amounts.
    Exposure(Address, Address),
}

#[contract]
pub struct ComplyRail;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_AMOUNT);
}

fn admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn require_admin(env: &Env) -> Result<Address, Error> {
    let a = admin(env)?;
    a.require_auth();
    Ok(a)
}

/// Travel Rule thresholds are governed by a separate role from the VASP
/// registry, so compromising one key does not let an attacker both admit a
/// VASP and lower the threshold that guards against it.
fn require_threshold_admin(env: &Env) -> Result<Address, Error> {
    let a: Address = env
        .storage()
        .instance()
        .get(&DataKey::ThresholdAdmin)
        .ok_or(Error::NotInitialized)?;
    a.require_auth();
    Ok(a)
}

/// A VASP's jurisdiction must name a real jurisdiction. `"*"` is reserved for
/// the threshold fallback, so a VASP registered under it would silently take
/// the fallback rule instead of its jurisdiction's rule.
fn validate_jurisdiction(env: &Env, jurisdiction: &String) -> Result<(), Error> {
    if jurisdiction.is_empty() || *jurisdiction == String::from_str(env, "*") {
        return Err(Error::InvalidJurisdiction);
    }
    Ok(())
}

fn load_vasp(env: &Env, addr: &Address) -> Result<VaspEntry, Error> {
    let key = DataKey::Vasp(addr.clone());
    let v: VaspEntry = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::VaspNotFound)?;
    bump_persistent(env, &key);
    Ok(v)
}

/// sha256 of a 32-byte public key, as emitted in `VaspKeyRotated`.
fn key_hash(env: &Env, key: &BytesN<32>) -> BytesN<32> {
    env.crypto()
        .sha256(&Bytes::from_slice(env, &key.to_array()))
        .to_bytes()
}

fn save_vasp(env: &Env, v: &VaspEntry) {
    let key = DataKey::Vasp(v.address.clone());
    env.storage().persistent().set(&key, v);
    bump_persistent(env, &key);
}

/// An expiry in the past would make the VASP inactive as soon as it is
/// written, which is almost always a data-entry mistake.
fn require_future_expiry(env: &Env, expires_at: Option<u64>) -> Result<(), Error> {
    if let Some(t) = expires_at {
        if t <= env.ledger().timestamp() {
            return Err(Error::InvalidInput);
        }
    }
    Ok(())
}

fn vasp_is_active(env: &Env, v: &VaspEntry) -> bool {
    if v.status != VaspStatus::Active {
        return false;
    }
    match v.expires_at {
        Some(exp) => env.ledger().timestamp() < exp,
        None => true,
    }
}

fn require_active_vasp(env: &Env, addr: &Address) -> Result<VaspEntry, Error> {
    let v = load_vasp(env, addr)?;
    if !vasp_is_active(env, &v) {
        return Err(Error::VaspNotActive);
    }
    Ok(v)
}

fn load_payment(env: &Env, id: u64) -> Result<Payment, Error> {
    let key = DataKey::Payment(id);
    let p: Payment = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::PaymentNotFound)?;
    bump_persistent(env, &key);
    Ok(p)
}

fn save_payment(env: &Env, p: &Payment) {
    let key = DataKey::Payment(p.id);
    env.storage().persistent().set(&key, p);
    bump_persistent(env, &key);
}

fn max_open_per_vasp(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxOpenPerVasp)
        .unwrap_or(DEFAULT_MAX_OPEN_PER_VASP)
}

fn open_count(env: &Env, vasp: &Address) -> u32 {
    let key = DataKey::OpenCount(vasp.clone());
    match env.storage().persistent().get::<_, u32>(&key) {
        Some(n) => {
            bump_persistent(env, &key);
            n
        }
        None => 0,
    }
}

fn set_open_count(env: &Env, vasp: &Address, n: u32) {
    let key = DataKey::OpenCount(vasp.clone());
    env.storage().persistent().set(&key, &n);
    bump_persistent(env, &key);
}

/// Frees one open slot for `p.from_vasp`. Only held payments
/// (`requires_attestation`) occupy a slot; `settle` calls this for them.
fn release_open_slot(env: &Env, p: &Payment) {
    let n = open_count(env, &p.from_vasp);
    set_open_count(env, &p.from_vasp, n.saturating_sub(1));
}

fn require_pending(p: &Payment) -> Result<(), Error> {
    if p.status != PaymentStatus::Pending {
        return Err(Error::PaymentNotPending);
    }
    Ok(())
}

/// Unresolved payment: `Pending` or `Queried`. Used where a payment may be
/// rejected or reclaimed even while the beneficiary has a query open.
fn require_open(p: &Payment) -> Result<(), Error> {
    match p.status {
        PaymentStatus::Pending | PaymentStatus::Queried => Ok(()),
        _ => Err(Error::PaymentNotPending),
    }
}

/// Threshold lookup: exact jurisdiction first, then the `"*"` wildcard.
/// If neither is configured the threshold is 0, i.e. *every* payment needs an
/// attestation. Failing closed is the safe default for a compliance tool.
fn threshold_for(env: &Env, asset: &Address, jurisdiction: &String) -> i128 {
    let exact = DataKey::Threshold(asset.clone(), jurisdiction.clone());
    if let Some(t) = env.storage().persistent().get::<_, i128>(&exact) {
        return t;
    }
    let wildcard = DataKey::Threshold(asset.clone(), String::from_str(env, "*"));
    env.storage()
        .persistent()
        .get::<_, i128>(&wildcard)
        .unwrap_or(0)
}

/// Appends a change to the rule's history, dropping the oldest entries so the
/// list never holds more than `MAX_THRESHOLD_HISTORY` items.
fn record_threshold_change(env: &Env, asset: &Address, jurisdiction: &String, amount: i128) {
    let key = DataKey::ThresholdHistory(asset.clone(), jurisdiction.clone());
    let old: Vec<ThresholdChange> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    let next_seq = if old.is_empty() {
        0
    } else {
        old.get(old.len() - 1).unwrap().seq + 1
    };
    let skip = (old.len() + 1).saturating_sub(MAX_THRESHOLD_HISTORY);
    let mut hist = Vec::new(env);
    for i in skip..old.len() {
        hist.push_back(old.get(i).unwrap());
    }
    hist.push_back(ThresholdChange {
        seq: next_seq,
        amount,
        changed_at: env.ledger().timestamp(),
    });
    env.storage().persistent().set(&key, &hist);
    bump_persistent(env, &key);
}

/// Uppercases a jurisdiction code and checks it against the allowlist.
/// Returns `None` for empty, over-long or unknown codes.
fn normalise_jurisdiction(env: &Env, raw: &String) -> Option<String> {
    let len = raw.len();
    if len == 0 || len > jurisdictions::MAX_LEN {
        return None;
    }
    let n = len as usize;
    let mut buf = [0u8; 3];
    raw.copy_into_slice(&mut buf[..n]);
    buf[..n].make_ascii_uppercase();
    let code = core::str::from_utf8(&buf[..n]).ok()?;
    if jurisdictions::ALLOWED.contains(&code) {
        Some(String::from_str(env, code))
    } else {
        None
    }
}

fn vasp_count_value(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::VaspCount)
        .unwrap_or(0)
}

fn exposure(env: &Env, vasp: &Address, asset: &Address) -> i128 {
    let key = DataKey::Exposure(vasp.clone(), asset.clone());
    env.storage().persistent().get(&key).unwrap_or(0)
}

fn set_exposure(env: &Env, vasp: &Address, asset: &Address, amount: i128) {
    let key = DataKey::Exposure(vasp.clone(), asset.clone());
    env.storage().persistent().set(&key, &amount);
    bump_persistent(env, &key);
}

fn index_vasp_payment(env: &Env, vasp: &Address, payment_id: u64) {
    let key = DataKey::VaspPayments(vasp.clone());
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(payment_id);
    env.storage().persistent().set(&key, &ids);
    bump_persistent(env, &key);
}

fn pending_index_add(env: &Env, payment_id: u64) {
    let key = DataKey::PendingPayments;
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(payment_id);
    env.storage().persistent().set(&key, &ids);
    bump_persistent(env, &key);
}

fn pending_index_remove(env: &Env, payment_id: u64) {
    let key = DataKey::PendingPayments;
    let Some(ids) = env.storage().persistent().get::<_, Vec<u64>>(&key) else {
        return;
    };
    let mut kept = Vec::new(env);
    for id in ids.iter() {
        if id != payment_id {
            kept.push_back(id);
        }
    }
    env.storage().persistent().set(&key, &kept);
    bump_persistent(env, &key);
}

/// Returns at most `min(limit, MAX_PAGE_SIZE)` entries of `ids` starting at
/// offset `start`. An out-of-range `start` yields an empty Vec.
fn page_of(env: &Env, ids: &Vec<u64>, start: u32, limit: u32) -> Vec<u64> {
    let mut page = Vec::new(env);
    let end = start
        .saturating_add(limit.min(MAX_PAGE_SIZE))
        .min(ids.len());
    let mut i = start;
    while i < end {
        page.push_back(ids.get(i).unwrap());
        i += 1;
    }
    page
}

/// Moves tokens with `try_transfer`, so a failing transfer surfaces as
/// `Error::TransferFailed` instead of an opaque host error.
fn transfer_tokens(
    env: &Env,
    asset: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) -> Result<(), Error> {
    let inner = token::Client::new(env, asset)
        .try_transfer(from, to, &amount)
        .map_err(|_| Error::TransferFailed)?;
    inner.map_err(|_| Error::TransferFailed)
}

fn settle(env: &Env, p: &mut Payment, to: &Address, status: PaymentStatus) -> Result<(), Error> {
    transfer_tokens(env, &p.asset, &env.current_contract_address(), to, p.amount)?;
    if p.requires_attestation {
        // A held payment is leaving escrow, so it stops counting towards exposure
        // and frees one of the originator's open-payment slots.
        let held = exposure(env, &p.from_vasp, &p.asset);
        set_exposure(env, &p.from_vasp, &p.asset, held - p.amount);
        release_open_slot(env, p);
    }
    p.status = status;
    p.resolved_at = Some(env.ledger().timestamp());
    p.resolved_ledger = Some(env.ledger().sequence());
    save_payment(env, p);
    // Every resolution leaves the pending queue. Instantly settled payments
    // were never in it, so this is a no-op for them.
    pending_index_remove(env, p.id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Events (topic names match the dashboard's audit log types)
// ---------------------------------------------------------------------------

#[contractevent(topics = ["vasp_reg"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaspRegistered {
    #[topic]
    pub address: Address,
    pub jurisdiction: String,
}

#[contractevent(topics = ["vasp_upd"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaspUpdated {
    #[topic]
    pub address: Address,
    pub status: VaspStatus,
    pub expires_at: Option<u64>,
    /// Why the status changed. Empty for expiry-only updates.
    pub reason: String,
}

/// Emitted on `vasp_upd` when a VASP rotates its encryption key. Carries
/// sha256 hashes of the old and new keys so the audit log can show the change
/// without re-publishing key material.
#[contractevent(topics = ["vasp_upd"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaspKeyRotated {
    #[topic]
    pub address: Address,
    pub old_key_hash: BytesN<32>,
    pub new_key_hash: BytesN<32>,
}

/// Emitted on `vasp_upd` when a VASP's legal name or jurisdiction changes.
/// Carries both the old and new values so the audit log shows the exact change.
#[contractevent(topics = ["vasp_upd"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaspMetadataUpdated {
    #[topic]
    pub address: Address,
    pub old_name: String,
    pub new_name: String,
    pub old_jurisdiction: String,
    pub new_jurisdiction: String,
}

#[contractevent(topics = ["thr_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdSet {
    #[topic]
    pub asset: Address,
    pub jurisdiction: String,
    pub amount: i128,
    /// `true` when the exact rule was removed (`amount` is then 0).
    pub removed: bool,
}

#[contractevent(topics = ["admin_chg"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    /// The incoming admin, so the audit log can filter by it.
    #[topic]
    pub new_admin: Address,
    pub old_admin: Address,
}

#[contractevent(topics = ["pay_sub"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentSubmitted {
    #[topic]
    pub id: u64,
    pub from_vasp: Address,
    pub to_vasp: Address,
    pub beneficiary: Address,
    pub asset: Address,
    pub amount: i128,
    pub requires_attestation: bool,
    pub created_ledger: u32,
}

#[contractevent(topics = ["att_sub"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationSubmitted {
    #[topic]
    pub id: u64,
    pub hash: BytesN<32>,
    pub ivms_version: String,
}

#[contractevent(topics = ["att_ack"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationAcknowledged {
    #[topic]
    pub id: u64,
    pub at: u64,
}

/// Emitted when the originator replaces an attestation before it is
/// acknowledged. Carries both hashes so the superseded one stays auditable.
#[contractevent(topics = ["att_amd"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationAmended {
    #[topic]
    pub id: u64,
    pub old_hash: BytesN<32>,
    pub new_hash: BytesN<32>,
    pub ivms_version: String,
}

/// Emitted when the admin releases a payment the beneficiary VASP has not
/// acknowledged. Keeps the override visible in the audit trail.
#[contractevent(topics = ["pay_ovr"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcknowledgementOverridden {
    #[topic]
    pub id: u64,
    pub admin: Address,
}

#[contractevent(topics = ["pay_rel"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentReleased {
    #[topic]
    pub id: u64,
    pub asset: Address,
    pub amount: i128,
    pub resolved_ledger: u32,
}

#[contractevent(topics = ["pay_qry"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentQueried {
    #[topic]
    pub id: u64,
    pub reason: String,
}

#[contractevent(topics = ["pay_rej"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRejected {
    #[topic]
    pub id: u64,
    pub asset: Address,
    pub reason: String,
    /// Optional sha256 of the evidence supporting the rejection (see
    /// `reject_payment` for the expected format). `None` for expiry reclaims.
    pub evidence_hash: Option<BytesN<32>>,
    pub resolved_ledger: u32,
}

#[contractevent(topics = ["pay_canc"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentCancelled {
    #[topic]
    pub id: u64,
    pub asset: Address,
    pub amount: i128,
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

#[contractimpl]
impl ComplyRail {
    /// Runs once, atomically with deployment, so nobody can front-run setup.
    /// `admin` does not need to sign: the deployer chooses it.
    /// `payment_ttl` is how long (seconds) a held payment can wait before the
    /// originator may reclaim it; pass `None` for 7 days.
    pub fn __constructor(
        env: Env,
        admin: Address,
        threshold_admin: Address,
        payment_ttl: Option<u64>,
    ) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::ThresholdAdmin, &threshold_admin);
        s.set(
            &DataKey::PaymentTtl,
            &payment_ttl.unwrap_or(DEFAULT_PAYMENT_TTL),
        );
        s.set(&DataKey::NextPaymentId, &0u64);
        s.set(&DataKey::VaspCount, &0u32);
        bump_instance(&env);
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        admin(&env)
    }

    /// Hand admin rights to a new address (both must sign).
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let old_admin = require_admin(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
        AdminChanged {
            new_admin,
            old_admin,
        }
        .publish(&env);
        Ok(())
    }

    // ----- VASP registry ---------------------------------------------------

    pub fn register_vasp(
        env: Env,
        address: Address,
        name: String,
        jurisdiction: String,
        public_key: BytesN<32>,
        expires_at: Option<u64>,
    ) -> Result<(), Error> {
        require_admin(&env)?;
        validate_jurisdiction(&env, &jurisdiction)?;
        let jurisdiction =
            normalise_jurisdiction(&env, &jurisdiction).ok_or(Error::UnknownJurisdiction)?;
        require_future_expiry(&env, expires_at)?;
        if env
            .storage()
            .persistent()
            .has(&DataKey::Vasp(address.clone()))
        {
            return Err(Error::VaspAlreadyRegistered);
        }
        let entry = VaspEntry {
            address: address.clone(),
            name,
            jurisdiction: jurisdiction.clone(),
            public_key,
            status: VaspStatus::Active,
            added_at: env.ledger().timestamp(),
            expires_at,
        };
        save_vasp(&env, &entry);

        let index = vasp_count_value(&env);
        let at = DataKey::VaspAt(index);
        env.storage().persistent().set(&at, &address);
        bump_persistent(&env, &at);
        env.storage().instance().set(&DataKey::VaspCount, &(index + 1));
        bump_instance(&env);

        VaspRegistered {
            address,
            jurisdiction,
        }
        .publish(&env);
        Ok(())
    }

    /// Sets a VASP's status. Suspending or revoking requires a non-empty
    /// `reason`; any reason is capped at `MAX_REASON_LEN` bytes. The reason is
    /// emitted in `VaspUpdated` for the audit trail.
    pub fn set_vasp_status(
        env: Env,
        address: Address,
        status: VaspStatus,
        reason: String,
    ) -> Result<(), Error> {
        require_admin(&env)?;
        if reason.len() > MAX_REASON_LEN {
            return Err(Error::ReasonTooLong);
        }
        if status != VaspStatus::Active && reason.is_empty() {
            return Err(Error::ReasonRequired);
        }
        let mut v = load_vasp(&env, &address)?;
        // Revocation is final: a revoked VASP can never be re-admitted or
        // suspended through this function. Re-setting `Revoked` is a no-op.
        if v.status == VaspStatus::Revoked && status != VaspStatus::Revoked {
            return Err(Error::VaspRevoked);
        }
        v.status = status;
        save_vasp(&env, &v);
        VaspUpdated {
            address,
            status,
            expires_at: v.expires_at,
            reason,
        }
        .publish(&env);
        Ok(())
    }

    pub fn set_vasp_expiry(
        env: Env,
        address: Address,
        expires_at: Option<u64>,
    ) -> Result<(), Error> {
        require_admin(&env)?;
        require_future_expiry(&env, expires_at)?;
        let mut v = load_vasp(&env, &address)?;
        v.expires_at = expires_at;
        save_vasp(&env, &v);
        VaspUpdated {
            address,
            status: v.status,
            expires_at,
            reason: String::from_str(&env, ""),
        }
        .publish(&env);
        Ok(())
    }

    /// Replace a VASP's encryption key (admin only). Only the key used to
    /// encrypt future IVMS101 payloads changes: payments already in flight
    /// keep their from/to VASP addresses, amounts, status and attestation.
    pub fn rotate_vasp_key(env: Env, address: Address, new_key: BytesN<32>) -> Result<(), Error> {
        require_admin(&env)?;
        let mut v = load_vasp(&env, &address)?;
        let old_key_hash = key_hash(&env, &v.public_key);
        let new_key_hash = key_hash(&env, &new_key);
        v.public_key = new_key;
        save_vasp(&env, &v);
        VaspKeyRotated {
            address,
            old_key_hash,
            new_key_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Change a VASP's legal name and/or jurisdiction (admin only).
    ///
    /// Jurisdiction decides which threshold applies, so the change only
    /// affects payments submitted after it. A payment's `requires_attestation`
    /// is fixed when it is submitted, so pending payments keep the jurisdiction
    /// they were submitted under: neither their attestation requirement nor
    /// their release path changes. The old and new values are emitted on
    /// `vasp_upd`.
    pub fn update_vasp(
        env: Env,
        address: Address,
        name: String,
        jurisdiction: String,
    ) -> Result<(), Error> {
        require_admin(&env)?;
        validate_jurisdiction(&env, &jurisdiction)?;
        let mut v = load_vasp(&env, &address)?;
        let event = VaspMetadataUpdated {
            address: address.clone(),
            old_name: v.name.clone(),
            new_name: name.clone(),
            old_jurisdiction: v.jurisdiction.clone(),
            new_jurisdiction: jurisdiction.clone(),
        };
        v.name = name;
        v.jurisdiction = jurisdiction;
        save_vasp(&env, &v);
        event.publish(&env);
        Ok(())
    }

    pub fn get_vasp(env: Env, address: Address) -> Result<VaspEntry, Error> {
        load_vasp(&env, &address)
    }

    /// True if the VASP exists, is `Active` and has not expired.
    pub fn is_vasp_active(env: Env, address: Address) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, VaspEntry>(&DataKey::Vasp(address))
        {
            Some(v) => vasp_is_active(&env, &v),
            None => false,
        }
    }

    /// Number of VASPs ever registered (the valid `list_vasps` index range).
    pub fn vasp_count(env: Env) -> u32 {
        vasp_count_value(&env)
    }

    /// Up to `limit` (capped at `MAX_VASP_PAGE`) registered VASP addresses,
    /// starting at index `start`. Returns an empty list past the end.
    pub fn list_vasps(env: Env, start: u32, limit: u32) -> Vec<Address> {
        let count = vasp_count_value(&env);
        let mut out = Vec::new(&env);
        let end = start
            .saturating_add(limit.min(MAX_VASP_PAGE))
            .min(count);
        for index in start..end {
            let key = DataKey::VaspAt(index);
            if let Some(addr) = env.storage().persistent().get::<_, Address>(&key) {
                bump_persistent(&env, &key);
                out.push_back(addr);
            }
        }
        out
    }

    // ----- Thresholds ------------------------------------------------------

    /// Amount (in the asset's smallest unit) at or above which a payment
    /// originating from `jurisdiction` needs an attestation. Use `"*"` as a
    /// fallback for jurisdictions without their own rule.
    pub fn set_threshold(
        env: Env,
        asset: Address,
        jurisdiction: String,
        amount: i128,
    ) -> Result<(), Error> {
        require_threshold_admin(&env)?;
        if !(0..=MAX_THRESHOLD).contains(&amount) {
            return Err(Error::InvalidThreshold);
        }
        let jurisdiction =
            normalise_jurisdiction(&env, &jurisdiction).ok_or(Error::UnknownJurisdiction)?;
        let key = DataKey::Threshold(asset.clone(), jurisdiction.clone());
        env.storage().persistent().set(&key, &amount);
        bump_persistent(&env, &key);
        record_threshold_change(&env, &asset, &jurisdiction, amount);
        ThresholdSet {
            asset,
            jurisdiction,
            amount,
            removed: false,
        }
        .publish(&env);
        Ok(())
    }

    /// Deletes the exact `(asset, jurisdiction)` rule so the `"*"` fallback
    /// applies to that jurisdiction again. Fails with `ThresholdNotFound` if no
    /// rule is set for that exact jurisdiction.
    pub fn remove_threshold(env: Env, asset: Address, jurisdiction: String) -> Result<(), Error> {
        require_threshold_admin(&env)?;
        let jurisdiction =
            normalise_jurisdiction(&env, &jurisdiction).ok_or(Error::UnknownJurisdiction)?;
        let key = DataKey::Threshold(asset.clone(), jurisdiction.clone());
        if !env.storage().persistent().has(&key) {
            return Err(Error::ThresholdNotFound);
        }
        env.storage().persistent().remove(&key);
        ThresholdSet {
            asset,
            jurisdiction,
            amount: 0,
            removed: true,
        }
        .publish(&env);
        Ok(())
    }

    /// Unknown or malformed codes read the `"*"` fallback, the same rule a
    /// payment from an unrecognised jurisdiction would hit.
    pub fn get_threshold(env: Env, asset: Address, jurisdiction: String) -> i128 {
        let j = normalise_jurisdiction(&env, &jurisdiction)
            .unwrap_or_else(|| String::from_str(&env, "*"));
        threshold_for(&env, &asset, &j)
    }

    /// Changelog for one `(asset, jurisdiction)` rule, oldest first. Returns up
    /// to `limit` entries (capped at `MAX_THRESHOLD_HISTORY`) starting at index
    /// `start` of the retained history. Past the end returns an empty list.
    pub fn threshold_history(
        env: Env,
        asset: Address,
        jurisdiction: String,
        start: u32,
        limit: u32,
    ) -> Vec<ThresholdChange> {
        let key = DataKey::ThresholdHistory(asset, jurisdiction);
        let hist: Vec<ThresholdChange> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        let end = hist
            .len()
            .min(start.saturating_add(limit.min(MAX_THRESHOLD_HISTORY)));
        let mut out = Vec::new(&env);
        for i in start..end {
            out.push_back(hist.get(i).unwrap());
        }
        out
    }

    // ----- Escrow exposure caps -------------------------------------------

    /// Caps the total value `vasp` may hold in escrow in `asset` at once.
    /// Only held (attestation-required) payments count. Without a cap the
    /// originator is unlimited.
    pub fn set_exposure_cap(
        env: Env,
        vasp: Address,
        asset: Address,
        amount: i128,
    ) -> Result<(), Error> {
        require_admin(&env)?;
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::ExposureCap(vasp, asset);
        env.storage().persistent().set(&key, &amount);
        bump_persistent(&env, &key);
        Ok(())
    }

    /// Admin sets the smallest payment accepted in `asset`. `0` disables the
    /// minimum (any positive amount is accepted).
    pub fn set_min_amount(env: Env, asset: Address, amount: i128) -> Result<(), Error> {
        require_admin(&env)?;
        if amount < 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::MinAmount(asset);
        env.storage().persistent().set(&key, &amount);
        bump_persistent(&env, &key);
        Ok(())
    }

    /// Smallest accepted payment in `asset` (0 when unset).
    pub fn get_min_amount(env: Env, asset: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::MinAmount(asset))
            .unwrap_or(0)
    }

    /// Current cap for `vasp` in `asset`, or `None` when uncapped.
    pub fn get_exposure_cap(env: Env, vasp: Address, asset: Address) -> Option<i128> {
        env.storage()
            .persistent()
            .get(&DataKey::ExposureCap(vasp, asset))
    }

    /// Sum of `vasp`'s currently held (pending) amounts in `asset`.
    pub fn get_exposure(env: Env, vasp: Address, asset: Address) -> i128 {
        exposure(&env, &vasp, &asset)
    }

    // ----- Open payment limit ----------------------------------------------

    /// Maximum number of held (pending) payments one originating VASP may have
    /// open at once. Must be at least 1.
    pub fn set_max_open_per_vasp(env: Env, limit: u32) -> Result<(), Error> {
        require_admin(&env)?;
        if limit == 0 {
            return Err(Error::InvalidLimit);
        }
        env.storage()
            .instance()
            .set(&DataKey::MaxOpenPerVasp, &limit);
        bump_instance(&env);
        Ok(())
    }

    pub fn get_max_open_per_vasp(env: Env) -> u32 {
        max_open_per_vasp(&env)
    }

    /// Number of held payments `vasp` currently has open.
    pub fn open_payment_count(env: Env, vasp: Address) -> u32 {
        open_count(&env, &vasp)
    }

    // ----- Payments --------------------------------------------------------

    /// Originating VASP sends `amount` of `asset` towards `beneficiary` at
    /// `to_vasp`. Tokens move into escrow. Below-threshold payments settle in
    /// the same call; others stay `Pending`. Returns the payment id.
    pub fn submit_payment(
        env: Env,
        from_vasp: Address,
        to_vasp: Address,
        beneficiary: Address,
        asset: Address,
        amount: i128,
    ) -> Result<u64, Error> {
        from_vasp.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let min_amount: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MinAmount(asset.clone()))
            .unwrap_or(0);
        if amount < min_amount {
            return Err(Error::BelowMinAmount);
        }
        if from_vasp == to_vasp {
            return Err(Error::SameVasp);
        }
        let origin = require_active_vasp(&env, &from_vasp)?;
        require_active_vasp(&env, &to_vasp)?;

        let requires_attestation = amount >= threshold_for(&env, &asset, &origin.jurisdiction);
        if requires_attestation {
            let cap_key = DataKey::ExposureCap(from_vasp.clone(), asset.clone());
            if let Some(cap) = env.storage().persistent().get::<_, i128>(&cap_key) {
                let total = exposure(&env, &from_vasp, &asset)
                    .checked_add(amount)
                    .ok_or(Error::ExposureCapExceeded)?;
                if total > cap {
                    return Err(Error::ExposureCapExceeded);
                }
            }
        }

        if requires_attestation && open_count(&env, &from_vasp) >= max_open_per_vasp(&env) {
            return Err(Error::OpenLimitReached);
        }

        transfer_tokens(
            &env,
            &asset,
            &from_vasp,
            &env.current_contract_address(),
            amount,
        )?;

        let s = env.storage().instance();
        let id: u64 = s.get(&DataKey::NextPaymentId).unwrap_or(0);
        s.set(&DataKey::NextPaymentId, &(id + 1));
        let ttl: u64 = s.get(&DataKey::PaymentTtl).unwrap_or(DEFAULT_PAYMENT_TTL);
        bump_instance(&env);

        let now = env.ledger().timestamp();
        let mut p = Payment {
            id,
            from_vasp: from_vasp.clone(),
            to_vasp: to_vasp.clone(),
            beneficiary: beneficiary.clone(),
            asset,
            amount,
            status: PaymentStatus::Pending,
            requires_attestation,
            attestation_hash: None,
            ivms_version: None,
            attested_at: None,
            acknowledged_at: None,
            created_at: now,
            created_ledger: env.ledger().sequence(),
            expires_at: now + ttl,
            resolved_at: None,
            resolved_ledger: None,
        };

        index_vasp_payment(&env, &from_vasp, id);
        index_vasp_payment(&env, &to_vasp, id);

        PaymentSubmitted {
            id,
            from_vasp,
            to_vasp,
            beneficiary: p.beneficiary.clone(),
            asset: p.asset.clone(),
            amount,
            requires_attestation,
            created_ledger: env.ledger().sequence(),
        }
        .publish(&env);

        if requires_attestation {
            let held = exposure(&env, &p.from_vasp, &p.asset);
            set_exposure(&env, &p.from_vasp, &p.asset, held + p.amount);
            let n = open_count(&env, &p.from_vasp);
            set_open_count(&env, &p.from_vasp, n + 1);
            save_payment(&env, &p);
            pending_index_add(&env, id);
        } else {
            settle(&env, &mut p, &beneficiary, PaymentStatus::Released)?;
            PaymentReleased {
                id,
                asset: p.asset.clone(),
                amount,
                resolved_ledger: env.ledger().sequence(),
            }
            .publish(&env);
        }
        Ok(id)
    }

    /// Originating VASP records the hash of the IVMS101 payload it sent to
    /// the beneficiary VASP off-chain.
    pub fn submit_attestation(
        env: Env,
        payment_id: u64,
        attestation_hash: BytesN<32>,
        ivms_version: String,
    ) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.from_vasp.require_auth();
        require_pending(&p)?;
        if p.attestation_hash.is_some() {
            return Err(Error::AttestationAlreadySubmitted);
        }
        p.attestation_hash = Some(attestation_hash.clone());
        p.ivms_version = Some(ivms_version.clone());
        p.attested_at = Some(env.ledger().timestamp());
        save_payment(&env, &p);
        // The first payment to record a hash keeps the reverse lookup, so a
        // later payment reusing the same hash cannot take it over.
        let owner_key = DataKey::AttestationOwner(attestation_hash.clone());
        if !env.storage().persistent().has(&owner_key) {
            env.storage().persistent().set(&owner_key, &payment_id);
            bump_persistent(&env, &owner_key);
        }
        AttestationSubmitted {
            id: payment_id,
            hash: attestation_hash,
            ivms_version,
        }
        .publish(&env);
        Ok(())
    }

    /// Originating VASP replaces the attestation of a held payment, for
    /// example to send a corrected IVMS101 payload. Allowed only until the
    /// beneficiary acknowledges. The superseded hash is emitted in `att_amd`.
    pub fn amend_attestation(
        env: Env,
        payment_id: u64,
        attestation_hash: BytesN<32>,
        ivms_version: String,
    ) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.from_vasp.require_auth();
        require_open(&p)?;
        if p.acknowledged_at.is_some() {
            return Err(Error::AlreadyAcknowledged);
        }
        let old_hash = p
            .attestation_hash
            .clone()
            .ok_or(Error::AttestationRequired)?;
        // Amending answers a query: the payment returns to Pending.
        p.status = PaymentStatus::Pending;
        let now = env.ledger().timestamp();
        p.attestation_hash = Some(attestation_hash.clone());
        p.ivms_version = Some(ivms_version.clone());
        p.attested_at = Some(now);
        save_payment(&env, &p);
        AttestationAmended {
            id: payment_id,
            old_hash,
            new_hash: attestation_hash,
            ivms_version,
        }
        .publish(&env);
        Ok(())
    }

    /// Beneficiary VASP confirms it has checked the IVMS101 payload against
    /// the attested hash. Release by the beneficiary requires this step.
    pub fn acknowledge_attestation(env: Env, payment_id: u64) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.to_vasp.require_auth();
        require_pending(&p)?;
        if p.attestation_hash.is_none() {
            return Err(Error::AttestationRequired);
        }
        if p.acknowledged_at.is_some() {
            return Err(Error::AlreadyAcknowledged);
        }
        let now = env.ledger().timestamp();
        p.acknowledged_at = Some(now);
        save_payment(&env, &p);
        AttestationAcknowledged {
            id: payment_id,
            at: now,
        }
        .publish(&env);
        Ok(())
    }

    /// Beneficiary VASP or admin releases a held payment to the beneficiary.
    /// The beneficiary must have acknowledged the attestation first. The admin
    /// may release without acknowledgement; that override emits `pay_ovr`.
    pub fn release_payment(env: Env, payment_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut p = load_payment(&env, payment_id)?;
        require_pending(&p)?;
        let admin_addr = admin(&env)?;
        if caller != p.to_vasp && caller != admin_addr {
            return Err(Error::Unauthorized);
        }
        // Re-check the beneficiary VASP at release time: it may have been
        // suspended, revoked or expired after the payment was submitted.
        // This applies to the admin override too; the admin cannot release
        // funds to a VASP that is not currently active.
        require_active_vasp(&env, &p.to_vasp)?;
        if p.requires_attestation && p.attestation_hash.is_none() {
            return Err(Error::AttestationRequired);
        }
        let overridden = if caller == p.to_vasp {
            if p.acknowledged_at.is_none() {
                return Err(Error::AttestationNotAcknowledged);
            }
            false
        } else {
            p.acknowledged_at.is_none()
        };
        let to = p.beneficiary.clone();
        settle(&env, &mut p, &to, PaymentStatus::Released)?;
        if overridden {
            AcknowledgementOverridden {
                id: payment_id,
                admin: admin_addr,
            }
            .publish(&env);
        }
        PaymentReleased {
            id: payment_id,
            asset: p.asset.clone(),
            amount: p.amount,
            resolved_ledger: env.ledger().sequence(),
        }
        .publish(&env);
        Ok(())
    }

    /// Beneficiary VASP asks the originator for more information about a
    /// held payment. Moves `Pending` to `Queried`. Not possible once the
    /// attestation is acknowledged; reject instead.
    pub fn query_payment(env: Env, payment_id: u64, reason: String) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.to_vasp.require_auth();
        require_pending(&p)?;
        if p.acknowledged_at.is_some() {
            return Err(Error::AlreadyAcknowledged);
        }
        p.status = PaymentStatus::Queried;
        save_payment(&env, &p);
        PaymentQueried {
            id: payment_id,
            reason,
        }
        .publish(&env);
        Ok(())
    }

    /// Beneficiary VASP or admin rejects a held payment; funds go back to the
    /// originating VASP. Allowed while `Pending` or `Queried`. `reason` is
    /// emitted for the audit trail.
    ///
    /// `evidence_hash` is optional. When given it must be the sha256 of the
    /// evidence document that justified the rejection, serialised as UTF-8
    /// JSON and exchanged off-chain between the VASPs and the admin. Only the
    /// hash is emitted in `pay_rej`; the document itself, and any personal
    /// data in it, never touches the ledger. Anyone reading the audit log can
    /// check a disclosed document by hashing it and comparing.
    pub fn reject_payment(
        env: Env,
        payment_id: u64,
        caller: Address,
        reason: String,
        evidence_hash: Option<BytesN<32>>,
    ) -> Result<(), Error> {
        caller.require_auth();
        let mut p = load_payment(&env, payment_id)?;
        require_open(&p)?;
        if caller != p.to_vasp && caller != admin(&env)? {
            return Err(Error::Unauthorized);
        }
        let to = p.from_vasp.clone();
        settle(&env, &mut p, &to, PaymentStatus::Rejected)?;
        PaymentRejected {
            id: payment_id,
            asset: p.asset.clone(),
            reason,
            evidence_hash,
            resolved_ledger: env.ledger().sequence(),
        }
        .publish(&env);
        Ok(())
    }

    /// After `expires_at`, the originating VASP can pull back a payment that
    /// was never released or rejected, so funds can't get stuck. This also
    /// applies while the payment is `Queried`.
    pub fn reclaim_expired(env: Env, payment_id: u64) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.from_vasp.require_auth();
        require_open(&p)?;
        if env.ledger().timestamp() < p.expires_at {
            return Err(Error::PaymentNotExpired);
        }
        let to = p.from_vasp.clone();
        settle(&env, &mut p, &to, PaymentStatus::Reclaimed)?;
        PaymentRejected {
            id: payment_id,
            asset: p.asset.clone(),
            reason: String::from_str(&env, "expired"),
            evidence_hash: None,
            resolved_ledger: env.ledger().sequence(),
        }
        .publish(&env);
        Ok(())
    }

    /// Originating VASP reclaims a held payment immediately when the
    /// receiving VASP is no longer active (revoked, suspended or expired),
    /// instead of waiting for `expires_at`.
    pub fn reclaim_inactive(env: Env, payment_id: u64) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.from_vasp.require_auth();
        require_pending(&p)?;
        let receiver = load_vasp(&env, &p.to_vasp)?;
        if vasp_is_active(&env, &receiver) {
            return Err(Error::ReceiverStillActive);
        }
        let to = p.from_vasp.clone();
        settle(&env, &mut p, &to, PaymentStatus::Reclaimed)?;
        PaymentRejected {
            id: payment_id,
            asset: p.asset.clone(),
            reason: String::from_str(&env, "receiver_inactive"),
            evidence_hash: None,
            resolved_ledger: env.ledger().sequence(),
        }
        .publish(&env);
        Ok(())
    }

    /// Admin refunds pending payments addressed to an inactive VASP, scanning
    /// payment ids `start_id..start_id + limit` (bounded by `MAX_REFUND_BATCH`).
    /// Returns the next id to resume from, or `payment_count` when finished.
    pub fn refund_pending_for_vasp(
        env: Env,
        vasp: Address,
        start_id: u64,
        limit: u64,
    ) -> Result<u64, Error> {
        require_admin(&env)?;
        if limit > MAX_REFUND_BATCH {
            return Err(Error::BatchTooLarge);
        }
        let receiver = load_vasp(&env, &vasp)?;
        if vasp_is_active(&env, &receiver) {
            return Err(Error::ReceiverStillActive);
        }
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextPaymentId)
            .unwrap_or(0);
        let end = core::cmp::min(start_id.saturating_add(limit), count);
        let mut id = start_id;
        while id < end {
            if let Some(mut p) = env
                .storage()
                .persistent()
                .get::<_, Payment>(&DataKey::Payment(id))
            {
                if p.status == PaymentStatus::Pending && p.to_vasp == vasp {
                    let to = p.from_vasp.clone();
                    settle(&env, &mut p, &to, PaymentStatus::Rejected)?;
                    PaymentRejected {
                        id,
            asset: p.asset.clone(),
                        reason: String::from_str(&env, "receiver_inactive"),
                        evidence_hash: None,
                        resolved_ledger: env.ledger().sequence(),
                    }
                    .publish(&env);
                }
            }
            id += 1;
        }
        Ok(end)
    }

    /// Originating VASP withdraws a held payment before any attestation was
    /// submitted. Funds return to the originator immediately, without waiting
    /// for the reclaim window.
    pub fn cancel_payment(env: Env, payment_id: u64) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.from_vasp.require_auth();
        require_pending(&p)?;
        if p.attestation_hash.is_some() {
            return Err(Error::AlreadyAttested);
        }
        let to = p.from_vasp.clone();
        let amount = p.amount;
        settle(&env, &mut p, &to, PaymentStatus::Cancelled)?;
        PaymentCancelled {
            id: payment_id,
            asset: p.asset.clone(),
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, Error> {
        load_payment(&env, payment_id)
    }

    /// Payment ids in which `vasp` is either originator or beneficiary, in
    /// submission order. Returns at most `min(limit, MAX_PAGE_SIZE)` ids
    /// starting at offset `start`; an out-of-range `start` yields an empty Vec.
    pub fn payments_for_vasp(env: Env, vasp: Address, start: u32, limit: u32) -> Vec<u64> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::VaspPayments(vasp))
            .unwrap_or_else(|| Vec::new(&env));
        page_of(&env, &ids, start, limit)
    }

    /// The payment that first recorded `attestation_hash`, if any. Lets a VASP
    /// that holds an IVMS101 payload find the payment it belongs to.
    pub fn find_payment_by_attestation(env: Env, attestation_hash: BytesN<32>) -> Option<u64> {
        let key = DataKey::AttestationOwner(attestation_hash);
        let id: Option<u64> = env.storage().persistent().get(&key);
        if id.is_some() {
            bump_persistent(&env, &key);
        }
        id
    }

    /// Payment ids currently held in escrow (awaiting attestation and/or
    /// release), in submission order. Paged like `payments_for_vasp`.
    pub fn list_pending(env: Env, start: u32, limit: u32) -> Vec<u64> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingPayments)
            .unwrap_or_else(|| Vec::new(&env));
        page_of(&env, &ids, start, limit)
    }

    /// Number of payments ever submitted (ids are `0..payment_count`).
    pub fn payment_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextPaymentId)
            .unwrap_or(0)
    }
}
