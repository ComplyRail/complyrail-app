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

    let id = env.register(
        ComplyRail,
        (admin.clone(), threshold_admin.clone(), None::<u64>),
    );
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
