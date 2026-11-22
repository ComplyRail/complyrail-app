#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, IntoVal, String,
};

struct Setup<'a> {
    env: Env,
    client: ComplyRailClient<'a>,
    admin: Address,
    vasp_a: Address,
    vasp_b: Address,
    beneficiary: Address,
    token: TokenClient<'a>,
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn key(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

fn setup<'a>() -> Setup<'a> {
    setup_with_ttl(None)
}

fn setup_with_ttl<'a>(payment_ttl: Option<u64>) -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);
    let vasp_a = Address::generate(&env);
    let vasp_b = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    StellarAssetClient::new(&env, &token_addr).mint(&vasp_a, &1_000_000);
    let token = TokenClient::new(&env, &token_addr);

    let id = env.register(ComplyRail, (admin.clone(), payment_ttl));
    let client = ComplyRailClient::new(&env, &id);
    client.register_vasp(
        &vasp_a,
        &s(&env, "Acme Exchange"),
        &s(&env, "US"),
        &key(&env, 1),
        &None,
    );
    client.register_vasp(
        &vasp_b,
        &s(&env, "Beta Finance"),
        &s(&env, "GB"),
        &key(&env, 2),
        &None,
    );
    client.set_threshold(&token_addr, &s(&env, "US"), &3_000);

    Setup {
        env,
        client,
        admin,
        vasp_a,
        vasp_b,
        beneficiary,
        token,
    }
}

// ----- init & admin --------------------------------------------------------

#[test]
fn error_codes_are_stable() {
    // The dashboard maps these numbers, so they must never change.
    assert_eq!(Error::AlreadyInitialized as u32, 1);
    assert_eq!(Error::NotInitialized as u32, 2);
    assert_eq!(Error::VaspAlreadyRegistered as u32, 3);
    assert_eq!(Error::VaspNotFound as u32, 4);
    assert_eq!(Error::VaspNotActive as u32, 5);
    assert_eq!(Error::InvalidAmount as u32, 6);
    assert_eq!(Error::PaymentNotFound as u32, 7);
    assert_eq!(Error::PaymentNotPending as u32, 8);
    assert_eq!(Error::AttestationRequired as u32, 9);
    assert_eq!(Error::AttestationAlreadySubmitted as u32, 10);
    assert_eq!(Error::Unauthorized as u32, 11);
    assert_eq!(Error::PaymentNotExpired as u32, 12);
    assert_eq!(Error::SameVasp as u32, 13);
    assert_eq!(Error::InvalidThreshold as u32, 14);
}

#[test]
fn initialize_sets_admin() {
    let t = setup();
    assert_eq!(t.client.admin(), t.admin);
}

#[test]
fn constructor_respects_custom_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(500);
    let admin = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    StellarAssetClient::new(&env, &sac.address()).mint(&a, &100);
    let id = env.register(ComplyRail, (admin.clone(), Some(60u64)));
    let c = ComplyRailClient::new(&env, &id);
    c.register_vasp(&a, &s(&env, "A"), &s(&env, "US"), &key(&env, 1), &None);
    c.register_vasp(&b, &s(&env, "B"), &s(&env, "GB"), &key(&env, 2), &None);
    let pid = c.submit_payment(&a, &b, &Address::generate(&env), &sac.address(), &10);
    assert_eq!(c.get_payment(&pid).expires_at, 560);
}

#[test]
fn transfer_admin_works() {
    let t = setup();
    let new_admin = Address::generate(&t.env);
    t.client.transfer_admin(&new_admin);
    assert_eq!(t.client.admin(), new_admin);
}

// ----- registry ------------------------------------------------------------

#[test]
fn register_and_get_vasp() {
    let t = setup();
    let v = t.client.get_vasp(&t.vasp_a);
    assert_eq!(v.name, s(&t.env, "Acme Exchange"));
    assert_eq!(v.jurisdiction, s(&t.env, "US"));
    assert_eq!(v.status, VaspStatus::Active);
    assert_eq!(v.added_at, 1_000);
    assert_eq!(t.client.list_vasps().len(), 2);
    assert!(t.client.is_vasp_active(&t.vasp_a));
}

#[test]
fn duplicate_registration_fails() {
    let t = setup();
    let r = t.client.try_register_vasp(
        &t.vasp_a,
        &s(&t.env, "x"),
        &s(&t.env, "US"),
        &key(&t.env, 9),
        &None,
    );
    assert_eq!(r, Err(Ok(Error::VaspAlreadyRegistered)));
}

#[test]
fn unknown_vasp_is_not_active() {
    let t = setup();
    assert!(!t.client.is_vasp_active(&Address::generate(&t.env)));
    let r = t.client.try_get_vasp(&Address::generate(&t.env));
    assert_eq!(r, Err(Ok(Error::VaspNotFound)));
}

#[test]
fn suspend_vasp_blocks_payments() {
    let t = setup();
    t.client.set_vasp_status(&t.vasp_b, &VaspStatus::Suspended);
    assert!(!t.client.is_vasp_active(&t.vasp_b));
    let r =
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &100);
    assert_eq!(r, Err(Ok(Error::VaspNotActive)));
}

#[test]
fn expired_vasp_is_inactive() {
    let t = setup();
    t.client.set_vasp_expiry(&t.vasp_a, &Some(2_000));
    assert!(t.client.is_vasp_active(&t.vasp_a));
    t.env.ledger().set_timestamp(2_000);
    assert!(!t.client.is_vasp_active(&t.vasp_a));
    let r =
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &100);
    assert_eq!(r, Err(Ok(Error::VaspNotActive)));
}

#[test]
#[should_panic]
fn register_requires_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin.clone(), None::<u64>));
    // no mock_all_auths(): admin has not signed
    let client = ComplyRailClient::new(&env, &id);
    client.register_vasp(
        &Address::generate(&env),
        &s(&env, "x"),
        &s(&env, "US"),
        &key(&env, 1),
        &None,
    );
}

// ----- thresholds ----------------------------------------------------------

#[test]
fn threshold_lookup_exact_wildcard_default() {
    let t = setup();
    let a = &t.token.address;
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "US")), 3_000);
    // nothing configured -> 0 (fail closed)
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "SG")), 0);
    t.client.set_threshold(a, &s(&t.env, "*"), &1_000);
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "SG")), 1_000);
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "US")), 3_000);
}

#[test]
fn negative_threshold_rejected() {
    let t = setup();
    let r = t
        .client
        .try_set_threshold(&t.token.address, &s(&t.env, "US"), &-1);
    assert_eq!(r, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn threshold_above_max_supply_rejected() {
    let t = setup();
    let a = &t.token.address;
    // the classic maximum is accepted...
    t.client.set_threshold(a, &s(&t.env, "US"), &MAX_THRESHOLD);
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "US")), MAX_THRESHOLD);
    // ...one unit more is not, and the stored value is left unchanged
    let r = t
        .client
        .try_set_threshold(a, &s(&t.env, "US"), &(MAX_THRESHOLD + 1));
    assert_eq!(r, Err(Ok(Error::InvalidThreshold)));
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "US")), MAX_THRESHOLD);
}

#[test]
fn threshold_history_records_changes_in_order() {
    let t = setup(); // setup() records US = 3_000 at ts 1_000
    let a = t.token.address.clone();
    let us = s(&t.env, "US");
    t.env.ledger().set_timestamp(2_000);
    t.client.set_threshold(&a, &us, &4_000);
    t.env.ledger().set_timestamp(3_000);
    t.client.set_threshold(&a, &us, &5_000);

    let h = t.client.threshold_history(&a, &us, &0, &10);
    assert_eq!(h.len(), 3);
    assert_eq!(
        h.get(0).unwrap(),
        ThresholdChange {
            seq: 0,
            amount: 3_000,
            changed_at: 1_000
        }
    );
    assert_eq!(
        h.get(2).unwrap(),
        ThresholdChange {
            seq: 2,
            amount: 5_000,
            changed_at: 3_000
        }
    );
}

#[test]
fn threshold_history_pages() {
    let t = setup();
    let a = t.token.address.clone();
    let us = s(&t.env, "US");
    t.client.set_threshold(&a, &us, &4_000);
    t.client.set_threshold(&a, &us, &5_000);

    let page = t.client.threshold_history(&a, &us, &1, &1);
    assert_eq!(page.len(), 1);
    assert_eq!(page.get(0).unwrap().amount, 4_000);

    let tail = t.client.threshold_history(&a, &us, &2, &50);
    assert_eq!(tail.len(), 1);
    assert_eq!(tail.get(0).unwrap().amount, 5_000);

    assert_eq!(t.client.threshold_history(&a, &us, &3, &10).len(), 0);
    assert_eq!(t.client.threshold_history(&a, &us, &0, &0).len(), 0);
}

#[test]
fn threshold_history_is_bounded() {
    let t = setup(); // seq 0 from setup
    let a = t.token.address.clone();
    let us = s(&t.env, "US");
    for i in 1..=(MAX_THRESHOLD_HISTORY as i128 + 5) {
        t.client.set_threshold(&a, &us, &(i * 10));
    }
    // 106 changes in total, so seq 0..=5 are trimmed and 6..=105 remain.
    // A request for more than the cap still returns at most the cap.
    let h = t.client.threshold_history(&a, &us, &0, &1_000);
    assert_eq!(h.len(), MAX_THRESHOLD_HISTORY);
    assert_eq!(h.get(0).unwrap().seq, 6);
    assert_eq!(h.get(99).unwrap().seq, 105);
    assert_eq!(h.get(99).unwrap().amount, 1_050);
}

#[test]
fn threshold_history_is_per_rule_and_skips_rejected_values() {
    let t = setup();
    let a = t.token.address.clone();
    let us = s(&t.env, "US");
    let star = s(&t.env, "*");
    t.client.set_threshold(&a, &star, &1_000);
    // a rejected value is not a change and must not be recorded
    let r = t.client.try_set_threshold(&a, &us, &-1);
    assert_eq!(r, Err(Ok(Error::InvalidThreshold)));

    assert_eq!(t.client.threshold_history(&a, &us, &0, &10).len(), 1);
    assert_eq!(t.client.threshold_history(&a, &star, &0, &10).len(), 1);
    let sg = s(&t.env, "SG");
    assert_eq!(t.client.threshold_history(&a, &sg, &0, &10).len(), 0);
}

#[test]
fn exact_jurisdiction_threshold_boundary() {
    // US rule is 3_000: "at or above" means 3_000 itself needs attestation.
    let t = setup();
    for (amount, expected) in [(2_999i128, false), (3_000, true), (3_001, true)] {
        let id = t.client.submit_payment(
            &t.vasp_a,
            &t.vasp_b,
            &t.beneficiary,
            &t.token.address,
            &amount,
        );
        assert_eq!(
            t.client.get_payment(&id).requires_attestation,
            expected,
            "amount {amount}"
        );
    }
}

#[test]
fn wildcard_threshold_boundary() {
    // SG has no rule of its own, so the "*" fallback of 1_000 applies.
    let t = setup();
    let token = t.token.address.clone();
    t.client.set_threshold(&token, &s(&t.env, "*"), &1_000);
    let sg_vasp = Address::generate(&t.env);
    t.client.register_vasp(
        &sg_vasp,
        &s(&t.env, "Lion Remit"),
        &s(&t.env, "SG"),
        &key(&t.env, 3),
        &None,
    );
    StellarAssetClient::new(&t.env, &token).mint(&sg_vasp, &10_000);
    for (amount, expected) in [(999i128, false), (1_000, true), (1_001, true)] {
        let id = t
            .client
            .submit_payment(&sg_vasp, &t.vasp_b, &t.beneficiary, &token, &amount);
        assert_eq!(
            t.client.get_payment(&id).requires_attestation,
            expected,
            "amount {amount}"
        );
    }
}

// ----- payments ------------------------------------------------------------

#[test]
fn below_threshold_settles_immediately() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &2_999,
    );
    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Released);
    assert!(!p.requires_attestation);
    assert_eq!(t.token.balance(&t.beneficiary), 2_999);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn above_threshold_full_flow() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Pending);
    assert!(p.requires_attestation);
    assert_eq!(t.token.balance(&t.client.address), 5_000);

    // cannot release without attestation
    let r = t.client.try_release_payment(&id, &t.vasp_b);
    assert_eq!(r, Err(Ok(Error::AttestationRequired)));

    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    let r = t
        .client
        .try_submit_attestation(&id, &key(&t.env, 8), &s(&t.env, "x"));
    assert_eq!(r, Err(Ok(Error::AttestationAlreadySubmitted)));

    t.client.release_payment(&id, &t.vasp_b);
    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Released);
    assert_eq!(p.attestation_hash, Some(key(&t.env, 7)));
    assert_eq!(p.ivms_version, Some(s(&t.env, "IVMS101.2023")));
    assert_eq!(p.resolved_at, Some(1_000));
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn reject_refunds_originator() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    t.client
        .reject_payment(&id, &t.vasp_b, &s(&t.env, "beneficiary name mismatch"));
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Rejected);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    // cannot act on a resolved payment
    let r = t.client.try_release_payment(&id, &t.vasp_b);
    assert_eq!(r, Err(Ok(Error::PaymentNotPending)));
}

#[test]
fn admin_can_release_and_outsider_cannot() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    let outsider = Address::generate(&t.env);
    assert_eq!(
        t.client.try_release_payment(&id, &outsider),
        Err(Ok(Error::Unauthorized))
    );
    // originator can't release its own payment either
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_a),
        Err(Ok(Error::Unauthorized))
    );
    t.client.release_payment(&id, &t.admin);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
}

#[test]
fn reclaim_only_after_expiry() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    assert_eq!(
        t.client.try_reclaim_expired(&id),
        Err(Ok(Error::PaymentNotExpired))
    );
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
}

#[test]
fn invalid_payments_rejected() {
    let t = setup();
    let a = &t.token.address;
    assert_eq!(
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_a, &t.beneficiary, a, &10),
        Err(Ok(Error::SameVasp))
    );
    let stranger = Address::generate(&t.env);
    assert_eq!(
        t.client
            .try_submit_payment(&stranger, &t.vasp_b, &t.beneficiary, a, &10),
        Err(Ok(Error::VaspNotFound))
    );
    assert_eq!(
        t.client.try_get_payment(&99),
        Err(Ok(Error::PaymentNotFound))
    );
}

#[test]
fn payment_ids_increment() {
    let t = setup();
    let a = &t.token.address;
    assert_eq!(
        t.client
            .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &10),
        0
    );
    assert_eq!(
        t.client
            .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &10),
        1
    );
    assert_eq!(t.client.payment_count(), 2);
}

#[test]
fn uncovered_jurisdiction_requires_attestation() {
    let t = setup();
    // vasp_b is GB and there is no GB or "*" rule -> threshold 0 -> held
    StellarAssetClient::new(&t.env, &t.token.address).mint(&t.vasp_b, &100);
    let id = t
        .client
        .submit_payment(&t.vasp_b, &t.vasp_a, &t.beneficiary, &t.token.address, &1);
    let p = t.client.get_payment(&id);
    assert!(p.requires_attestation);
    assert_eq!(p.status, PaymentStatus::Pending);
}

// ----- beneficiary VASP status changes while a payment is held (#62) ------

/// Submits a 5_000 payment from vasp_a to vasp_b, which is above the US
/// threshold of 3_000, so it is held in escrow.
fn submit_held(t: &Setup) -> u64 {
    t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    )
}

#[test]
fn release_settles_after_beneficiary_vasp_suspended() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    t.client.set_vasp_status(&t.vasp_b, &VaspStatus::Suspended);
    assert!(!t.client.is_vasp_active(&t.vasp_b));

    // Current behaviour: release is not gated on the beneficiary VASP's status.
    t.client.release_payment(&id, &t.vasp_b);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Released);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn release_settles_after_beneficiary_vasp_expires() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    t.client.set_vasp_expiry(&t.vasp_b, &Some(2_000));
    t.env.ledger().set_timestamp(2_000);
    assert!(!t.client.is_vasp_active(&t.vasp_b));

    // Current behaviour: release is not gated on the beneficiary VASP's expiry.
    t.client.release_payment(&id, &t.vasp_b);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Released);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

// ----- races around payment expiry (#63) -----------------------------------

#[test]
fn release_then_reclaim_at_expiry_leaves_one_terminal_state() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    let expires_at = t.client.get_payment(&id).expires_at;
    t.env.ledger().set_timestamp(expires_at);

    t.client.release_payment(&id, &t.vasp_b);
    // Reclaim at the same ledger time must not run after the release.
    assert_eq!(
        t.client.try_reclaim_expired(&id),
        Err(Ok(Error::PaymentNotPending))
    );

    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Released);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000 - 5_000);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn reclaim_then_release_at_expiry_leaves_one_terminal_state() {
    let t = setup();
    let id = submit_held(&t);
    let expires_at = t.client.get_payment(&id).expires_at;
    t.env.ledger().set_timestamp(expires_at);

    t.client.reclaim_expired(&id);
    // Release at the same ledger time must not run after the reclaim.
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::PaymentNotPending))
    );

    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn attest_at_expiry_is_recorded_but_payment_stays_pending() {
    let t = setup();
    let id = submit_held(&t);
    let expires_at = t.client.get_payment(&id).expires_at;
    t.env.ledger().set_timestamp(expires_at);

    // Current behaviour: attestation is not gated on expiry.
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Pending);
    assert_eq!(p.attestation_hash, Some(key(&t.env, 7)));
    assert_eq!(p.attested_at, Some(expires_at));
    assert_eq!(t.token.balance(&t.client.address), 5_000);
}

#[test]
fn attest_then_expire_reclaims_and_blocks_release() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    let expires_at = t.client.get_payment(&id).expires_at;
    t.env.ledger().set_timestamp(expires_at);
    t.client.reclaim_expired(&id);

    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::PaymentNotPending))
    );
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
}

#[test]
fn attest_after_reclaim_is_rejected() {
    let t = setup();
    let id = submit_held(&t);
    let expires_at = t.client.get_payment(&id).expires_at;
    t.env.ledger().set_timestamp(expires_at);
    t.client.reclaim_expired(&id);

    assert_eq!(
        t.client
            .try_submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023")),
        Err(Ok(Error::PaymentNotPending))
    );
    assert_eq!(t.client.get_payment(&id).attestation_hash, None);
}

// ----- admin hand-over (#65) ------------------------------------------------

/// Creates a contract with real auth checks and hands admin rights from
/// `admin` to `new_admin`. Only the two transfer signatures are mocked.
fn env_after_admin_transfer() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin.clone(), None::<u64>));

    let args: soroban_sdk::Vec<soroban_sdk::Val> = (new_admin.clone(),).into_val(&env);
    let by_admin = MockAuthInvoke {
        contract: &id,
        fn_name: "transfer_admin",
        args: args.clone(),
        sub_invokes: &[],
    };
    let by_new = MockAuthInvoke {
        contract: &id,
        fn_name: "transfer_admin",
        args,
        sub_invokes: &[],
    };
    env.mock_auths(&[
        MockAuth {
            address: &admin,
            invoke: &by_admin,
        },
        MockAuth {
            address: &new_admin,
            invoke: &by_new,
        },
    ]);
    ComplyRailClient::new(&env, &id).transfer_admin(&new_admin);
    (env, id, admin, new_admin)
}

#[test]
fn previous_admin_loses_registry_and_threshold_rights() {
    let (env, id, admin, new_admin) = env_after_admin_transfer();
    let client = ComplyRailClient::new(&env, &id);
    assert_eq!(client.admin(), new_admin);
    assert_ne!(client.admin(), admin);

    let vasp = Address::generate(&env);
    let token = Address::generate(&env);

    // The old admin signs, but the contract now requires the new admin.
    let args = (
        vasp.clone(),
        s(&env, "Old Admin"),
        s(&env, "US"),
        key(&env, 1),
        None::<u64>,
    )
        .into_val(&env);
    let inv = MockAuthInvoke {
        contract: &id,
        fn_name: "register_vasp",
        args,
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &inv,
    }]);
    let r = client.try_register_vasp(
        &vasp,
        &s(&env, "Old Admin"),
        &s(&env, "US"),
        &key(&env, 1),
        &None,
    );
    assert!(matches!(r, Err(Err(_))));
    assert_eq!(client.list_vasps().len(), 0);

    let args = (token.clone(), s(&env, "US"), 100i128).into_val(&env);
    let inv = MockAuthInvoke {
        contract: &id,
        fn_name: "set_threshold",
        args,
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &inv,
    }]);
    let r = client.try_set_threshold(&token, &s(&env, "US"), &100);
    assert!(matches!(r, Err(Err(_))));
    assert_eq!(client.get_threshold(&token, &s(&env, "US")), 0);
}

#[test]
fn new_admin_can_register_and_set_threshold() {
    let (env, id, _admin, new_admin) = env_after_admin_transfer();
    let client = ComplyRailClient::new(&env, &id);

    let vasp = Address::generate(&env);
    let args = (
        vasp.clone(),
        s(&env, "New Admin VASP"),
        s(&env, "US"),
        key(&env, 1),
        None::<u64>,
    )
        .into_val(&env);
    let inv = MockAuthInvoke {
        contract: &id,
        fn_name: "register_vasp",
        args,
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &new_admin,
        invoke: &inv,
    }]);
    client.register_vasp(
        &vasp,
        &s(&env, "New Admin VASP"),
        &s(&env, "US"),
        &key(&env, 1),
        &None,
    );
    assert!(client.is_vasp_active(&vasp));

    let token = Address::generate(&env);
    let args = (token.clone(), s(&env, "US"), 100i128).into_val(&env);
    let inv = MockAuthInvoke {
        contract: &id,
        fn_name: "set_threshold",
        args,
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &new_admin,
        invoke: &inv,
    }]);
    client.set_threshold(&token, &s(&env, "US"), &100);
    assert_eq!(client.get_threshold(&token, &s(&env, "US")), 100);
}

// ----- extreme payment_ttl values (#64) ------------------------------------

#[test]
fn zero_ttl_makes_payment_reclaimable_immediately() {
    let t = setup_with_ttl(Some(0));
    let id = submit_held(&t);
    let p = t.client.get_payment(&id);
    assert_eq!(p.created_at, 1_000);
    assert_eq!(p.expires_at, 1_000);

    // Expiry is inclusive, so reclaim succeeds in the same ledger.
    t.client.reclaim_expired(&id);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn max_ttl_makes_submission_fail_without_side_effects() {
    let t = setup_with_ttl(Some(u64::MAX));
    // now (1_000) + u64::MAX overflows. The host aborts the call, which
    // surfaces as an invocation failure rather than a contract error.
    let r = t.client.try_submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    assert!(matches!(r, Err(Err(_))));

    // The failed call is rolled back: no payment, no escrowed funds.
    assert_eq!(t.client.payment_count(), 0);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.client.address), 0);
}
