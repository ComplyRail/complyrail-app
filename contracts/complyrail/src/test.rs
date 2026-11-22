#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Events as _, xdr};
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, IntoVal, String, TryFromVal,
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
    let threshold_admin = Address::generate(&env);
    let vasp_a = Address::generate(&env);
    let vasp_b = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    StellarAssetClient::new(&env, &token_addr).mint(&vasp_a, &1_000_000);
    let token = TokenClient::new(&env, &token_addr);

    let id = env.register(ComplyRail, (admin.clone(), threshold_admin.clone(), payment_ttl));
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
    let threshold_admin = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    StellarAssetClient::new(&env, &sac.address()).mint(&a, &100);
    let id = env.register(
        ComplyRail,
        (admin.clone(), threshold_admin.clone(), Some(60u64)),
    );
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
    assert_eq!(t.client.list_vasps(&0, &10).len(), 2);
    assert_eq!(t.client.vasp_count(), 2);
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
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "test reason"));
    assert!(!t.client.is_vasp_active(&t.vasp_b));
    let r =
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &100);
    assert_eq!(r, Err(Ok(Error::VaspNotActive)));
}

#[test]
fn suspended_vasp_can_be_reactivated() {
    let t = setup();
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "test reason"));
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Active, &s(&t.env, "test reason"));
    assert!(t.client.is_vasp_active(&t.vasp_b));
}

#[test]
fn revoked_vasp_cannot_be_reactivated_or_suspended() {
    let t = setup();
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &s(&t.env, "test reason"));
    assert_eq!(
        t.client
            .try_set_vasp_status(&t.vasp_b, &VaspStatus::Active, &s(&t.env, "test reason")),
        Err(Ok(Error::VaspRevoked))
    );
    assert_eq!(
        t.client
            .try_set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "test reason")),
        Err(Ok(Error::VaspRevoked))
    );
    // the failed attempts left the status untouched
    assert_eq!(t.client.get_vasp(&t.vasp_b).status, VaspStatus::Revoked);
    assert!(!t.client.is_vasp_active(&t.vasp_b));
}

#[test]
fn suspend_and_revoke_require_a_reason() {
    let t = setup();
    assert_eq!(
        t.client
            .try_set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "")),
        Err(Ok(Error::ReasonRequired))
    );
    assert_eq!(
        t.client
            .try_set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &s(&t.env, "")),
        Err(Ok(Error::ReasonRequired))
    );
    // a failed attempt does not change the status
    assert_eq!(t.client.get_vasp(&t.vasp_b).status, VaspStatus::Active);
}

#[test]
fn reactivation_does_not_require_a_reason() {
    let t = setup();
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "review"));
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Active, &s(&t.env, ""));
    assert!(t.client.is_vasp_active(&t.vasp_b));
}

#[test]
fn reason_length_is_bounded() {
    let t = setup();
    let at_limit = String::from_bytes(&t.env, &[b'a'; MAX_REASON_LEN as usize]);
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &at_limit);
    let too_long = String::from_bytes(&t.env, &[b'a'; MAX_REASON_LEN as usize + 1]);
    assert_eq!(
        t.client
            .try_set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &too_long),
        Err(Ok(Error::ReasonTooLong))
    );
    assert_eq!(
        t.client
            .try_set_vasp_status(&t.vasp_b, &VaspStatus::Active, &too_long),
        Err(Ok(Error::ReasonTooLong))
    );
}

#[test]
fn register_rejects_past_expiry() {
    let t = setup(); // ledger time is 1_000
    let r = t.client.try_register_vasp(
        &Address::generate(&t.env),
        &s(&t.env, "Late"),
        &s(&t.env, "US"),
        &key(&t.env, 5),
        &Some(1_000),
    );
    assert_eq!(r, Err(Ok(Error::InvalidInput)));
    let r = t.client.try_register_vasp(
        &Address::generate(&t.env),
        &s(&t.env, "Older"),
        &s(&t.env, "US"),
        &key(&t.env, 5),
        &Some(999),
    );
    assert_eq!(r, Err(Ok(Error::InvalidInput)));
}

#[test]
fn register_accepts_future_expiry() {
    let t = setup();
    let vasp = Address::generate(&t.env);
    t.client.register_vasp(
        &vasp,
        &s(&t.env, "Future"),
        &s(&t.env, "US"),
        &key(&t.env, 5),
        &Some(1_001),
    );
    assert_eq!(t.client.get_vasp(&vasp).expires_at, Some(1_001));
}

#[test]
fn set_expiry_rejects_past_and_keeps_previous_value() {
    let t = setup();
    t.client.set_vasp_expiry(&t.vasp_a, &Some(5_000));
    assert_eq!(
        t.client.try_set_vasp_expiry(&t.vasp_a, &Some(1_000)),
        Err(Ok(Error::InvalidInput))
    );
    assert_eq!(t.client.get_vasp(&t.vasp_a).expires_at, Some(5_000));
}

#[test]
fn set_expiry_none_still_clears_expiry() {
    let t = setup();
    t.client.set_vasp_expiry(&t.vasp_a, &Some(5_000));
    t.client.set_vasp_expiry(&t.vasp_a, &None);
    assert_eq!(t.client.get_vasp(&t.vasp_a).expires_at, None);
}

#[test]
fn revoking_again_is_allowed() {
    let t = setup();
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &s(&t.env, "test reason"));
    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &s(&t.env, "test reason"));
    assert_eq!(t.client.get_vasp(&t.vasp_b).status, VaspStatus::Revoked);
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
    let threshold_admin = Address::generate(&env);
    let id = env.register(
        ComplyRail,
        (admin.clone(), threshold_admin.clone(), None::<u64>),
    );
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
    t.client.reject_payment(
        &id,
        &t.vasp_b,
        &s(&t.env, "beneficiary name mismatch"),
        &None,
    );
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Rejected);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    // cannot act on a resolved payment
    let r = t.client.try_release_payment(&id, &t.vasp_b);
    assert_eq!(r, Err(Ok(Error::PaymentNotPending)));
}

#[test]
fn admin_reject_with_attestation_refunds_originator() {
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
    t.client
        .reject_payment(&id, &t.admin, &s(&t.env, "admin override"), &None);

    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Rejected);
    assert_eq!(p.attestation_hash, Some(key(&t.env, 7)));
    assert_eq!(p.resolved_at, Some(1_000));
    // refund goes to the originator only
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.vasp_b), 0);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn admin_reject_without_attestation_refunds_originator() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    t.client
        .reject_payment(&id, &t.admin, &s(&t.env, "sanctions screening hit"), &None);

    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Rejected);
    assert_eq!(p.attestation_hash, None);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.vasp_b), 0);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
    assert_eq!(t.token.balance(&t.client.address), 0);
}

#[test]
fn admin_release_skips_beneficiary_check_but_not_attestation() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    // admin is not the beneficiary VASP, but the attestation is still required
    assert_eq!(
        t.client.try_release_payment(&id, &t.admin),
        Err(Ok(Error::AttestationRequired))
    );

    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.release_payment(&id, &t.admin);

    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Released);
    // funds go to the beneficiary address, never to the beneficiary VASP
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
    assert_eq!(t.token.balance(&t.vasp_b), 0);
    assert_eq!(t.token.balance(&t.client.address), 0);
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

    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "test reason"));
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
fn env_after_admin_transfer() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let threshold_admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin.clone(), threshold_admin.clone(), None::<u64>));

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
    (env, id, admin, new_admin, threshold_admin)
}

#[test]
fn previous_admin_loses_registry_and_threshold_rights() {
    let (env, id, admin, new_admin, _threshold_admin) = env_after_admin_transfer();
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
    assert_eq!(client.list_vasps(&0, &10).len(), 0);

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

// ----- role separation -----------------------------------------------------

/// Registers a contract with no blanket auth mocking, so each test decides
/// exactly which role has signed a given call.
fn role_env() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(&env);
    let threshold_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(
        ComplyRail,
        (admin.clone(), threshold_admin.clone(), None::<u64>),
    );
    (env, id, admin, threshold_admin, sac.address())
}

#[test]
fn threshold_admin_can_set_threshold() {
    let (env, id, _admin, thr, token) = role_env();
    env.mock_auths(&[MockAuth {
        address: &thr,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "set_threshold",
            args: (token.clone(), s(&env, "US"), 3_000i128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let client = ComplyRailClient::new(&env, &id);
    client.set_threshold(&token, &s(&env, "US"), &3_000);
    assert_eq!(client.get_threshold(&token, &s(&env, "US")), 3_000);
}

#[test]
fn admin_cannot_set_threshold() {
    let (env, id, admin, _thr, token) = role_env();
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "set_threshold",
            args: (token.clone(), s(&env, "US"), 1i128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let client = ComplyRailClient::new(&env, &id);
    assert!(client
        .try_set_threshold(&token, &s(&env, "US"), &1)
        .is_err());
    assert_eq!(client.get_threshold(&token, &s(&env, "US")), 0);
}

#[test]
fn new_admin_registers_vasp_and_threshold_admin_sets_threshold() {
    let (env, id, _admin, new_admin, threshold_admin) = env_after_admin_transfer();
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
        address: &threshold_admin,
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

#[test]
fn threshold_admin_cannot_register_vasp() {
    let (env, id, _admin, thr, _token) = role_env();
    let vasp = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &thr,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "register_vasp",
            args: (
                vasp.clone(),
                s(&env, "Acme"),
                s(&env, "US"),
                key(&env, 1),
                None::<u64>,
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let client = ComplyRailClient::new(&env, &id);
    assert!(client
        .try_register_vasp(
            &vasp,
            &s(&env, "Acme"),
            &s(&env, "US"),
            &key(&env, 1),
            &None
        )
        .is_err());
    assert!(!client.is_vasp_active(&vasp));
}

#[test]
fn admin_cannot_remove_threshold() {
    let t = setup();
    // seed a per-jurisdiction threshold, then try to remove it as the admin
    let env = &t.env;
    env.mock_auths(&[MockAuth {
        address: &t.admin,
        invoke: &MockAuthInvoke {
            contract: &t.client.address,
            fn_name: "remove_threshold",
            args: (t.token.address.clone(), s(env, "US")).into_val(env),
            sub_invokes: &[],
        },
    }]);
    assert!(t
        .client
        .try_remove_threshold(&t.token.address, &s(env, "US"))
        .is_err());
    assert_eq!(
        t.client.get_threshold(&t.token.address, &s(env, "US")),
        3_000
    );
}

#[test]
fn threshold_admin_can_remove_threshold() {
    let t = setup();
    t.client
        .remove_threshold(&t.token.address, &s(&t.env, "US"));
    // no "*" fallback configured, so the jurisdiction now fails closed
    assert_eq!(
        t.client.get_threshold(&t.token.address, &s(&t.env, "US")),
        0
    );
}

#[test]
fn removing_missing_threshold_fails() {
    let t = setup();
    assert_eq!(
        t.client
            .try_remove_threshold(&t.token.address, &s(&t.env, "SG")),
        Err(Ok(Error::ThresholdNotFound))
    );
}

// ----- jurisdiction normalisation & allowlist ------------------------------

#[test]
fn jurisdiction_is_stored_uppercase() {
    let t = setup();
    let c = &t.client;
    let v = Address::generate(&t.env);
    c.register_vasp(&v, &s(&t.env, "Lower"), &s(&t.env, "sg"), &key(&t.env, 9), &None);
    assert_eq!(c.get_vasp(&v).jurisdiction, s(&t.env, "SG"));
}

#[test]
fn threshold_lowercase_matches_uppercase_rule() {
    let t = setup();
    let a = &t.token.address;
    // "us" and "US" are the same jurisdiction
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "us")), 3_000);
    t.client.set_threshold(a, &s(&t.env, "gb"), &500);
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "GB")), 500);
}

#[test]
fn unknown_jurisdiction_rejected() {
    let t = setup();
    let v = Address::generate(&t.env);
    assert_eq!(
        t.client.try_register_vasp(&v, &s(&t.env, "X"), &s(&t.env, "XX"), &key(&t.env, 3), &None),
        Err(Ok(Error::UnknownJurisdiction))
    );
    assert_eq!(
        t.client.try_set_threshold(&t.token.address, &s(&t.env, "Xyz"), &1),
        Err(Ok(Error::UnknownJurisdiction))
    );
}

#[test]
fn jurisdiction_length_is_checked() {
    let t = setup();
    let v = Address::generate(&t.env);
    // empty is reserved as invalid; other codes that are not on the allowlist are unknown
    assert_eq!(
        t.client.try_register_vasp(&v, &s(&t.env, "X"), &s(&t.env, ""), &key(&t.env, 4), &None),
        Err(Ok(Error::InvalidJurisdiction))
    );
    for code in ["USA", "toolong"] {
        assert_eq!(
            t.client.try_register_vasp(&v, &s(&t.env, "X"), &s(&t.env, code), &key(&t.env, 4), &None),
            Err(Ok(Error::UnknownJurisdiction)),
            "code {code:?} should be rejected"
        );
    }
}

#[test]
fn wildcard_applies_after_threshold_removed() {
    let t = setup();
    let a = &t.token.address;
    t.client.set_threshold(a, &s(&t.env, "*"), &1_000);
    t.client.set_threshold(a, &s(&t.env, "SG"), &5_000);
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "SG")), 5_000);

    t.client.remove_threshold(a, &s(&t.env, "SG"));
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "SG")), 1_000);

    // removing again fails: the exact rule no longer exists
    assert_eq!(
        t.client.try_remove_threshold(a, &s(&t.env, "SG")),
        Err(Ok(Error::ThresholdNotFound))
    );
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "SG")), 1_000);
}

#[test]
fn remove_threshold_normalises_jurisdiction() {
    let t = setup();
    let a = &t.token.address;
    t.client.set_threshold(a, &s(&t.env, "*"), &1_000);
    t.client.set_threshold(a, &s(&t.env, "HK"), &7_000);
    t.client.remove_threshold(a, &s(&t.env, "hk"));
    assert_eq!(t.client.get_threshold(a, &s(&t.env, "HK")), 1_000);
    assert_eq!(
        t.client.try_remove_threshold(a, &s(&t.env, "XX")),
        Err(Ok(Error::UnknownJurisdiction))
    );
}

// ----- event assertions ----------------------------------------------------

/// Asserts that the most recent event emitted by the contract is exactly
/// `expected`: same topics, same data, same emitting contract.
fn assert_last_event(t: &Setup, expected: &impl soroban_sdk::Event) {
    let env = &t.env;
    let all = env.events().all().filter_by_contract(&t.client.address);
    let last = all.events().last().expect("no events emitted");
    let xdr::ContractEventBody::V0(body) = &last.body;
    let topics = expected.topics(env);
    assert_eq!(body.topics.len() as u32, topics.len());
    for (i, topic) in topics.iter().enumerate() {
        assert_eq!(
            body.topics[i],
            xdr::ScVal::try_from_val(env, &topic).unwrap()
        );
    }
    assert_eq!(
        body.data,
        xdr::ScVal::try_from_val(env, &expected.data(env)).unwrap()
    );
}

// ----- rejection evidence (#45) --------------------------------------------

#[test]
fn reject_with_evidence_hash_emits_it() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    let reason = s(&t.env, "beneficiary name mismatch");
    t.client
        .reject_payment(&id, &t.vasp_b, &reason, &Some(key(&t.env, 9)));
    assert_last_event(
        &t,
        &PaymentRejected {
            id,
            reason,
            evidence_hash: Some(key(&t.env, 9)),
        },
    );
}

#[test]
fn vasp_list_is_paged_over_many_registrations() {
    let t = setup();
    // setup() registers 2 VASPs; add 298 more for 300 in total.
    let mut all = Vec::new(&t.env);
    all.push_back(t.vasp_a.clone());
    all.push_back(t.vasp_b.clone());
    for i in 0..298u32 {
        let addr = Address::generate(&t.env);
        t.client.register_vasp(
            &addr,
            &s(&t.env, "Bulk"),
            &s(&t.env, "US"),
            &key(&t.env, (i % 250) as u8 + 1),
            &None,
        );
        all.push_back(addr);
    }
    assert_eq!(t.client.vasp_count(), 300);

    // pages are capped at MAX_VASP_PAGE even when a bigger limit is asked
    let first = t.client.list_vasps(&0, &1_000);
    assert_eq!(first.len(), MAX_VASP_PAGE);
    assert_eq!(first.get(0).unwrap(), all.get(0).unwrap());

    // walk the whole list page by page and compare with registration order
    let mut seen = Vec::new(&t.env);
    let mut start = 0;
    loop {
        let page = t.client.list_vasps(&start, &MAX_VASP_PAGE);
        if page.is_empty() {
            break;
        }
        for addr in page.iter() {
            seen.push_back(addr);
        }
        start += MAX_VASP_PAGE;
    }
    assert_eq!(seen, all);

    // the tail page and past-the-end requests
    assert_eq!(t.client.list_vasps(&290, &100).len(), 10);
    assert_eq!(t.client.list_vasps(&300, &10).len(), 0);
    assert_eq!(t.client.list_vasps(&u32::MAX, &u32::MAX).len(), 0);
}

#[test]
fn transfer_admin_emits_admin_chg() {
    use soroban_sdk::{testutils::Events, Event};
    let t = setup();
    let new_admin = Address::generate(&t.env);
    t.client.transfer_admin(&new_admin);

    let expected = AdminChanged {
        new_admin: new_admin.clone(),
        old_admin: t.admin.clone(),
    }
    .to_xdr(&t.env, &t.client.address);
    let events = t.env.events().all();
    assert!(
        events.events().contains(&expected),
        "admin_chg event with old and new admin should be emitted"
    );
}

#[test]
fn reject_without_evidence_hash_emits_none() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    let reason = s(&t.env, "duplicate");
    t.client.reject_payment(&id, &t.vasp_b, &reason, &None);
    assert_last_event(
        &t,
        &PaymentRejected {
            id,
            reason,
            evidence_hash: None,
        },
    );
}

#[test]
fn expiry_reclaim_emits_no_evidence_hash() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);
    assert_last_event(
        &t,
        &PaymentRejected {
            id,
            reason: s(&t.env, "expired"),
            evidence_hash: None,
        },
    );
}

// ----- key rotation (#46) --------------------------------------------------

#[test]
fn rotate_key_updates_key_and_emits_hashes() {
    let t = setup();
    let before = t.client.get_vasp(&t.vasp_a);
    let new_key = key(&t.env, 5);
    t.client.rotate_vasp_key(&t.vasp_a, &new_key);
    // checked before any other client call, which would reset the event buffer
    assert_last_event(
        &t,
        &VaspKeyRotated {
            address: t.vasp_a.clone(),
            old_key_hash: key_hash(&t.env, &before.public_key),
            new_key_hash: key_hash(&t.env, &new_key),
        },
    );

    let after = t.client.get_vasp(&t.vasp_a);
    assert_eq!(after.public_key, new_key);
    // everything else on the registry entry is untouched
    assert_eq!(after.name, before.name);
    assert_eq!(after.jurisdiction, before.jurisdiction);
    assert_eq!(after.status, before.status);
    assert_eq!(after.added_at, before.added_at);
    assert_eq!(after.expires_at, before.expires_at);
}

#[test]
fn rotation_does_not_change_payments() {
    let t = setup();
    // held payment (above the US threshold) submitted before the rotation
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    let before = t.client.get_payment(&id);

    t.client.rotate_vasp_key(&t.vasp_b, &key(&t.env, 6));
    t.client.rotate_vasp_key(&t.vasp_a, &key(&t.env, 7));

    assert_eq!(t.client.get_payment(&id), before);

    // the in-flight payment still settles between the same parties
    t.client
        .submit_attestation(&id, &key(&t.env, 8), &s(&t.env, "IVMS101.2023"));
    t.client.release_payment(&id, &t.vasp_b);
    let released = t.client.get_payment(&id);
    assert_eq!(released.status, PaymentStatus::Released);
    assert_eq!(released.from_vasp, t.vasp_a);
    assert_eq!(released.to_vasp, t.vasp_b);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);

    // and payments submitted after the rotation work as before
    let next = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &100,
    );
    assert_eq!(t.client.get_payment(&next).status, PaymentStatus::Released);
}

#[test]
fn rotate_unknown_vasp_fails() {
    let t = setup();
    let r = t
        .client
        .try_rotate_vasp_key(&Address::generate(&t.env), &key(&t.env, 5));
    assert_eq!(r, Err(Ok(Error::VaspNotFound)));
}

#[test]
#[should_panic]
fn rotate_key_requires_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin.clone(), None::<u64>));
    // no mock_all_auths(): admin has not signed
    let client = ComplyRailClient::new(&env, &id);
    client.rotate_vasp_key(&Address::generate(&env), &key(&env, 5));
}

// ----- metadata updates (#47) ----------------------------------------------

#[test]
fn update_vasp_changes_fields_and_emits_old_and_new() {
    let t = setup();
    let before = t.client.get_vasp(&t.vasp_a);
    let new_name = s(&t.env, "Acme Exchange Ltd");
    let new_jurisdiction = s(&t.env, "GB");
    t.client
        .update_vasp(&t.vasp_a, &new_name, &new_jurisdiction);

    assert_last_event(
        &t,
        &VaspMetadataUpdated {
            address: t.vasp_a.clone(),
            old_name: before.name,
            new_name: new_name.clone(),
            old_jurisdiction: before.jurisdiction,
            new_jurisdiction: new_jurisdiction.clone(),
        },
    );

    let after = t.client.get_vasp(&t.vasp_a);
    assert_eq!(after.name, new_name);
    assert_eq!(after.jurisdiction, new_jurisdiction);
    // key, status and expiry are not touched by a metadata update
    assert_eq!(after.public_key, key(&t.env, 1));
    assert_eq!(after.status, VaspStatus::Active);
    assert_eq!(after.expires_at, None);
}

#[test]
fn jurisdiction_change_applies_to_new_payments_only() {
    let t = setup();
    // US threshold is 3_000 (set in setup); GB gets its own, higher rule
    t.client
        .set_threshold(&t.token.address, &s(&t.env, "GB"), &10_000);

    // under US: 5_000 is at or above 3_000 -> held for attestation
    let held = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    assert!(t.client.get_payment(&held).requires_attestation);

    t.client
        .update_vasp(&t.vasp_a, &s(&t.env, "Acme Exchange"), &s(&t.env, "GB"));

    // the pending payment keeps the decision it was submitted with
    let still_held = t.client.get_payment(&held);
    assert!(still_held.requires_attestation);
    assert_eq!(still_held.status, PaymentStatus::Pending);
    t.client
        .submit_attestation(&held, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.release_payment(&held, &t.vasp_b);
    assert_eq!(t.client.get_payment(&held).status, PaymentStatus::Released);

    // a payment submitted after the change is judged under GB
    let fresh = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
    );
    let fresh = t.client.get_payment(&fresh);
    assert!(!fresh.requires_attestation);
    assert_eq!(fresh.status, PaymentStatus::Released);
}

#[test]
fn update_unknown_vasp_fails() {
    let t = setup();
    let r = t.client.try_update_vasp(
        &Address::generate(&t.env),
        &s(&t.env, "x"),
        &s(&t.env, "US"),
    );
    assert_eq!(r, Err(Ok(Error::VaspNotFound)));
}

#[test]
#[should_panic]
fn update_vasp_requires_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin.clone(), None::<u64>));
    // no mock_all_auths(): admin has not signed
    let client = ComplyRailClient::new(&env, &id);
    client.update_vasp(
        &Address::generate(&env),
        &s(&env, "x"),
        &s(&env, "US"),
    );
}

// ----- jurisdiction validation (#48) ---------------------------------------

#[test]
fn register_rejects_wildcard_jurisdiction() {
    let t = setup();
    let r = t.client.try_register_vasp(
        &Address::generate(&t.env),
        &s(&t.env, "Wild"),
        &s(&t.env, "*"),
        &key(&t.env, 9),
        &None,
    );
    assert_eq!(r, Err(Ok(Error::InvalidJurisdiction)));
}

#[test]
fn register_rejects_empty_jurisdiction() {
    let t = setup();
    let r = t.client.try_register_vasp(
        &Address::generate(&t.env),
        &s(&t.env, "Nowhere"),
        &s(&t.env, ""),
        &key(&t.env, 9),
        &None,
    );
    assert_eq!(r, Err(Ok(Error::InvalidJurisdiction)));
}

#[test]
fn update_rejects_wildcard_jurisdiction() {
    let t = setup();
    let r = t
        .client
        .try_update_vasp(&t.vasp_a, &s(&t.env, "Acme Exchange"), &s(&t.env, "*"));
    assert_eq!(r, Err(Ok(Error::InvalidJurisdiction)));
    // rejected update leaves the entry as it was
    assert_eq!(t.client.get_vasp(&t.vasp_a).jurisdiction, s(&t.env, "US"));
}

#[test]
fn update_rejects_empty_jurisdiction() {
    let t = setup();
    let r = t
        .client
        .try_update_vasp(&t.vasp_a, &s(&t.env, "Acme Exchange"), &s(&t.env, ""));
    assert_eq!(r, Err(Ok(Error::InvalidJurisdiction)));
    assert_eq!(t.client.get_vasp(&t.vasp_a).jurisdiction, s(&t.env, "US"));
}
