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
//! Every state change emits an event whose topic matches the dashboard's
//! audit log types (`vasp_reg`, `vasp_upd`, `thr_set`, `pay_sub`, `att_sub`,
//! `pay_rel`, `pay_rej`).

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, BytesN,
    Env, String, Vec,
};

mod test;

/// Default time (seconds) a held payment may wait for release before the
/// originator can reclaim it: 7 days.
pub const DEFAULT_PAYMENT_TTL: u64 = 7 * 24 * 60 * 60;

/// Largest number of payments a single paginated read returns.
pub const MAX_PAGE_SIZE: u32 = 50;

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Reserved (unused since setup moved to the constructor).
    AlreadyInitialized = 1,
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
    NoPendingAdmin = 15,
}

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
    Released,
    Rejected,
    /// Expired and refunded to the originator.
    Reclaimed,
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
    pub created_at: u64,
    pub expires_at: u64,
    pub resolved_at: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    /// Admin proposed by `propose_admin`, not yet accepted.
    PendingAdmin,
    PaymentTtl,
    NextPaymentId,
    VaspList,
    /// Index of `(asset, jurisdiction)` rules whose amount is above zero.
    ThresholdList,
    Vasp(Address),
    Threshold(Address, String),
    Payment(u64),
    /// Number of payments indexed for a VASP (as originator or beneficiary).
    VaspPaymentCount(Address),
    /// The `n`-th payment id indexed for a VASP, in submission order.
    VaspPayment(Address, u64),
}

/// One configured threshold rule, as stored in the threshold index.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdKey {
    pub asset: Address,
    pub jurisdiction: String,
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

fn save_vasp(env: &Env, v: &VaspEntry) {
    let key = DataKey::Vasp(v.address.clone());
    env.storage().persistent().set(&key, v);
    bump_persistent(env, &key);
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

/// Appends a payment id to a VASP's index (one storage entry per payment, so
/// the index never grows into a single large entry).
fn index_vasp_payment(env: &Env, vasp: &Address, id: u64) {
    let count_key = DataKey::VaspPaymentCount(vasp.clone());
    let n: u64 = env.storage().persistent().get(&count_key).unwrap_or(0);
    let key = DataKey::VaspPayment(vasp.clone(), n);
    env.storage().persistent().set(&key, &id);
    bump_persistent(env, &key);
    env.storage().persistent().set(&count_key, &(n + 1));
    bump_persistent(env, &count_key);
}

fn page_len(limit: u32) -> u64 {
    limit.min(MAX_PAGE_SIZE) as u64
}

fn require_pending(p: &Payment) -> Result<(), Error> {
    if p.status != PaymentStatus::Pending {
        return Err(Error::PaymentNotPending);
    }
    Ok(())
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

fn threshold_index(env: &Env) -> Vec<ThresholdKey> {
    env.storage()
        .instance()
        .get(&DataKey::ThresholdList)
        .unwrap_or_else(|| Vec::new(env))
}

/// Adds the rule to the index when `active`, removes it otherwise.
fn update_threshold_index(env: &Env, asset: &Address, jurisdiction: &String, active: bool) {
    let mut index = threshold_index(env);
    let pos = index
        .iter()
        .position(|k| k.asset == *asset && k.jurisdiction == *jurisdiction);
    match (active, pos) {
        (true, None) => index.push_back(ThresholdKey {
            asset: asset.clone(),
            jurisdiction: jurisdiction.clone(),
        }),
        (false, Some(i)) => {
            index.remove(i as u32);
        }
        _ => return,
    }
    env.storage()
        .instance()
        .set(&DataKey::ThresholdList, &index);
    bump_instance(env);
}

fn settle(env: &Env, p: &mut Payment, to: &Address, status: PaymentStatus) {
    token::Client::new(env, &p.asset).transfer(&env.current_contract_address(), to, &p.amount);
    p.status = status;
    p.resolved_at = Some(env.ledger().timestamp());
    save_payment(env, p);
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
}

#[contractevent(topics = ["thr_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdSet {
    #[topic]
    pub asset: Address,
    pub jurisdiction: String,
    pub amount: i128,
}

#[contractevent(topics = ["pay_sub"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentSubmitted {
    #[topic]
    pub id: u64,
    pub from_vasp: Address,
    pub to_vasp: Address,
    pub amount: i128,
    pub requires_attestation: bool,
}

#[contractevent(topics = ["att_sub"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationSubmitted {
    #[topic]
    pub id: u64,
    pub hash: BytesN<32>,
    pub ivms_version: String,
}

#[contractevent(topics = ["pay_rel"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentReleased {
    #[topic]
    pub id: u64,
    pub amount: i128,
}

#[contractevent(topics = ["adm_prop"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposed {
    pub proposed: Address,
}

#[contractevent(topics = ["adm_acc"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminAccepted {
    pub previous: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["pay_rej"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRejected {
    #[topic]
    pub id: u64,
    pub reason: String,
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
    pub fn __constructor(env: Env, admin: Address, payment_ttl: Option<u64>) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(
            &DataKey::PaymentTtl,
            &payment_ttl.unwrap_or(DEFAULT_PAYMENT_TTL),
        );
        s.set(&DataKey::NextPaymentId, &0u64);
        s.set(&DataKey::VaspList, &Vec::<Address>::new(&env));
        s.set(&DataKey::ThresholdList, &Vec::<ThresholdKey>::new(&env));
        bump_instance(&env);
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        admin(&env)
    }

    /// Step 1 of a handover: the current admin proposes `new_admin`. Replaces
    /// any earlier proposal and changes nothing until `accept_admin`.
    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        bump_instance(&env);
        AdminProposed {
            proposed: new_admin,
        }
        .publish(&env);
        Ok(())
    }

    /// Step 2: the proposed admin accepts. `caller` must be the proposed
    /// address and must sign; any other address gets `Unauthorized`.
    pub fn accept_admin(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NoPendingAdmin)?;
        if caller != pending {
            return Err(Error::Unauthorized);
        }
        let previous = admin(&env)?;
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &pending);
        s.remove(&DataKey::PendingAdmin);
        bump_instance(&env);
        AdminAccepted {
            previous,
            new_admin: pending,
        }
        .publish(&env);
        Ok(())
    }

    /// Current admin withdraws the pending proposal.
    pub fn cancel_admin_proposal(env: Env) -> Result<(), Error> {
        require_admin(&env)?;
        let s = env.storage().instance();
        if !s.has(&DataKey::PendingAdmin) {
            return Err(Error::NoPendingAdmin);
        }
        s.remove(&DataKey::PendingAdmin);
        bump_instance(&env);
        Ok(())
    }

    /// The proposed admin awaiting `accept_admin`, if any.
    pub fn pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
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

        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::VaspList)
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(address.clone());
        env.storage().instance().set(&DataKey::VaspList, &list);
        bump_instance(&env);

        VaspRegistered {
            address,
            jurisdiction,
        }
        .publish(&env);
        Ok(())
    }

    pub fn set_vasp_status(env: Env, address: Address, status: VaspStatus) -> Result<(), Error> {
        require_admin(&env)?;
        let mut v = load_vasp(&env, &address)?;
        v.status = status;
        save_vasp(&env, &v);
        VaspUpdated {
            address,
            status,
            expires_at: v.expires_at,
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
        let mut v = load_vasp(&env, &address)?;
        v.expires_at = expires_at;
        save_vasp(&env, &v);
        VaspUpdated {
            address,
            status: v.status,
            expires_at,
        }
        .publish(&env);
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

    pub fn list_vasps(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::VaspList)
            .unwrap_or_else(|| Vec::new(&env))
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
        require_admin(&env)?;
        if amount < 0 {
            return Err(Error::InvalidThreshold);
        }
        let key = DataKey::Threshold(asset.clone(), jurisdiction.clone());
        // Keep the stored value even at 0: an explicit 0 overrides the `"*"`
        // fallback (fail closed), so it must not be deleted.
        env.storage().persistent().set(&key, &amount);
        bump_persistent(&env, &key);
        update_threshold_index(&env, &asset, &jurisdiction, amount > 0);
        ThresholdSet {
            asset,
            jurisdiction,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_threshold(env: Env, asset: Address, jurisdiction: String) -> i128 {
        threshold_for(&env, &asset, &jurisdiction)
    }

    /// Every configured rule with a non-zero amount, as
    /// `(asset, jurisdiction, amount)`. A rule set to 0 is dropped from this
    /// list but still answers `get_threshold` with 0.
    pub fn list_thresholds(env: Env) -> Vec<(Address, String, i128)> {
        let mut out = Vec::new(&env);
        for k in threshold_index(&env).iter() {
            let amount: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Threshold(k.asset.clone(), k.jurisdiction.clone()))
                .unwrap_or(0);
            out.push_back((k.asset, k.jurisdiction, amount));
        }
        out
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
        if from_vasp == to_vasp {
            return Err(Error::SameVasp);
        }
        let origin = require_active_vasp(&env, &from_vasp)?;
        require_active_vasp(&env, &to_vasp)?;

        token::Client::new(&env, &asset).transfer(
            &from_vasp,
            env.current_contract_address(),
            &amount,
        );

        let s = env.storage().instance();
        let id: u64 = s.get(&DataKey::NextPaymentId).unwrap_or(0);
        s.set(&DataKey::NextPaymentId, &(id + 1));
        let ttl: u64 = s.get(&DataKey::PaymentTtl).unwrap_or(DEFAULT_PAYMENT_TTL);
        bump_instance(&env);

        let now = env.ledger().timestamp();
        let requires_attestation = amount >= threshold_for(&env, &asset, &origin.jurisdiction);
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
            created_at: now,
            expires_at: now + ttl,
            resolved_at: None,
        };

        index_vasp_payment(&env, &from_vasp, id);
        index_vasp_payment(&env, &to_vasp, id);

        PaymentSubmitted {
            id,
            from_vasp,
            to_vasp,
            amount,
            requires_attestation,
        }
        .publish(&env);

        if requires_attestation {
            save_payment(&env, &p);
        } else {
            settle(&env, &mut p, &beneficiary, PaymentStatus::Released);
            PaymentReleased { id, amount }.publish(&env);
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
        AttestationSubmitted {
            id: payment_id,
            hash: attestation_hash,
            ivms_version,
        }
        .publish(&env);
        Ok(())
    }

    /// Beneficiary VASP (after checking the IVMS101 payload matches the hash)
    /// or the admin releases a held payment to the beneficiary.
    pub fn release_payment(env: Env, payment_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut p = load_payment(&env, payment_id)?;
        require_pending(&p)?;
        if caller != p.to_vasp && caller != admin(&env)? {
            return Err(Error::Unauthorized);
        }
        if p.requires_attestation && p.attestation_hash.is_none() {
            return Err(Error::AttestationRequired);
        }
        let to = p.beneficiary.clone();
        settle(&env, &mut p, &to, PaymentStatus::Released);
        PaymentReleased {
            id: payment_id,
            amount: p.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Beneficiary VASP or admin rejects a held payment; funds go back to the
    /// originating VASP. `reason` is emitted for the audit trail.
    pub fn reject_payment(
        env: Env,
        payment_id: u64,
        caller: Address,
        reason: String,
    ) -> Result<(), Error> {
        caller.require_auth();
        let mut p = load_payment(&env, payment_id)?;
        require_pending(&p)?;
        if caller != p.to_vasp && caller != admin(&env)? {
            return Err(Error::Unauthorized);
        }
        let to = p.from_vasp.clone();
        settle(&env, &mut p, &to, PaymentStatus::Rejected);
        PaymentRejected {
            id: payment_id,
            reason,
        }
        .publish(&env);
        Ok(())
    }

    /// After `expires_at`, the originating VASP can pull back a payment that
    /// was never released or rejected, so funds can't get stuck.
    pub fn reclaim_expired(env: Env, payment_id: u64) -> Result<(), Error> {
        let mut p = load_payment(&env, payment_id)?;
        p.from_vasp.require_auth();
        require_pending(&p)?;
        if env.ledger().timestamp() < p.expires_at {
            return Err(Error::PaymentNotExpired);
        }
        let to = p.from_vasp.clone();
        settle(&env, &mut p, &to, PaymentStatus::Reclaimed);
        PaymentRejected {
            id: payment_id,
            reason: String::from_str(&env, "expired"),
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, Error> {
        load_payment(&env, payment_id)
    }

    /// Number of payments ever submitted (ids are `0..payment_count`).
    pub fn payment_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextPaymentId)
            .unwrap_or(0)
    }

    /// Payments with ids `start..start+limit`, ascending. `limit` is capped at
    /// `MAX_PAGE_SIZE`; a page past the end (or `limit` 0) is empty.
    pub fn list_payments(env: Env, start: u64, limit: u32) -> Vec<Payment> {
        let mut out = Vec::new(&env);
        let end = start
            .saturating_add(page_len(limit))
            .min(Self::payment_count(env.clone()));
        let mut id = start;
        while id < end {
            if let Ok(p) = load_payment(&env, id) {
                out.push_back(p);
            }
            id += 1;
        }
        out
    }

    /// Payments involving `vasp` (as originator or beneficiary side), in
    /// submission order, starting at position `start` of that VASP's index.
    /// `limit` is capped at `MAX_PAGE_SIZE`.
    pub fn list_payments_by_vasp(env: Env, vasp: Address, start: u64, limit: u32) -> Vec<Payment> {
        let mut out = Vec::new(&env);
        let count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::VaspPaymentCount(vasp.clone()))
            .unwrap_or(0);
        let end = start.saturating_add(page_len(limit)).min(count);
        let mut n = start;
        while n < end {
            let id: Option<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::VaspPayment(vasp.clone(), n));
            if let Some(id) = id {
                if let Ok(p) = load_payment(&env, id) {
                    out.push_back(p);
                }
            }
            n += 1;
        }
        out
    }
}
