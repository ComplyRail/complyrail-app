#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String,
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
    let vasp_a = Address::generate(&env);
    let vasp_b = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    StellarAssetClient::new(&env, &token_addr).mint(&vasp_a, &1_000_000);
    let token = TokenClient::new(&env, &token_addr);

    let id = env.register(ComplyRail, (admin.clone(), None::<u64>));
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
fn two_step_admin_handover() {
    let t = setup();
    let new_admin = Address::generate(&t.env);
    t.client.propose_admin(&new_admin);
    // nothing changes until the proposed admin accepts
    assert_eq!(t.client.admin(), t.admin);
    assert_eq!(t.client.pending_admin(), Some(new_admin.clone()));
    t.client.accept_admin(&new_admin);
    assert_eq!(t.client.admin(), new_admin);
    assert_eq!(t.client.pending_admin(), None);
}

#[test]
fn accept_from_wrong_address_fails() {
    let t = setup();
    let new_admin = Address::generate(&t.env);
    let outsider = Address::generate(&t.env);
    t.client.propose_admin(&new_admin);
    let r = t.client.try_accept_admin(&outsider);
    assert_eq!(r, Err(Ok(Error::Unauthorized)));
    assert_eq!(t.client.admin(), t.admin);
    assert_eq!(t.client.pending_admin(), Some(new_admin));
}

#[test]
fn accept_without_proposal_fails() {
    let t = setup();
    let r = t.client.try_accept_admin(&t.vasp_a);
    assert_eq!(r, Err(Ok(Error::NoPendingAdmin)));
}

#[test]
fn cancel_proposal_blocks_accept() {
    let t = setup();
    let new_admin = Address::generate(&t.env);
    t.client.propose_admin(&new_admin);
    t.client.cancel_admin_proposal();
    assert_eq!(t.client.pending_admin(), None);
    let r = t.client.try_accept_admin(&new_admin);
    assert_eq!(r, Err(Ok(Error::NoPendingAdmin)));
    assert_eq!(t.client.admin(), t.admin);
}

#[test]
fn cancel_without_proposal_fails() {
    let t = setup();
    let r = t.client.try_cancel_admin_proposal();
    assert_eq!(r, Err(Ok(Error::NoPendingAdmin)));
}

#[test]
fn re_proposing_replaces_the_earlier_candidate() {
    let t = setup();
    let first = Address::generate(&t.env);
    let second = Address::generate(&t.env);
    t.client.propose_admin(&first);
    t.client.propose_admin(&second);
    assert_eq!(t.client.pending_admin(), Some(second.clone()));
    let r = t.client.try_accept_admin(&first);
    assert_eq!(r, Err(Ok(Error::Unauthorized)));
    t.client.accept_admin(&second);
    assert_eq!(t.client.admin(), second);
}

#[test]
#[should_panic]
fn propose_requires_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin.clone(), None::<u64>));
    // no mock_all_auths(): the admin has not signed
    let client = ComplyRailClient::new(&env, &id);
    client.propose_admin(&Address::generate(&env));
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

// ----- threshold index (list_thresholds) -----------------------------------

#[test]
fn list_thresholds_includes_configured_rules() {
    let t = setup();
    let a = t.token.address.clone();
    let rules = t.client.list_thresholds();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules.get(0).unwrap(), (a, s(&t.env, "US"), 3_000));
}

#[test]
fn list_thresholds_adds_new_rules_without_duplicates() {
    let t = setup();
    let a = t.token.address.clone();
    t.client.set_threshold(&a, &s(&t.env, "*"), &1_000);
    // updating an existing rule must not add a second entry
    t.client.set_threshold(&a, &s(&t.env, "US"), &4_500);
    let rules = t.client.list_thresholds();
    assert_eq!(rules.len(), 2);
    assert_eq!(rules.get(0).unwrap(), (a.clone(), s(&t.env, "US"), 4_500));
    assert_eq!(rules.get(1).unwrap(), (a, s(&t.env, "*"), 1_000));
}

#[test]
fn setting_threshold_to_zero_removes_it_from_list() {
    let t = setup();
    let a = t.token.address.clone();
    t.client.set_threshold(&a, &s(&t.env, "*"), &1_000);
    t.client.set_threshold(&a, &s(&t.env, "US"), &0);
    let rules = t.client.list_thresholds();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules.get(0).unwrap(), (a.clone(), s(&t.env, "*"), 1_000));
    // The explicit 0 still answers lookups and does not fall back to "*".
    assert_eq!(t.client.get_threshold(&a, &s(&t.env, "US")), 0);
}

#[test]
fn zero_rule_can_be_re_added() {
    let t = setup();
    let a = t.token.address.clone();
    t.client.set_threshold(&a, &s(&t.env, "US"), &0);
    assert_eq!(t.client.list_thresholds().len(), 0);
    t.client.set_threshold(&a, &s(&t.env, "US"), &750);
    let rules = t.client.list_thresholds();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules.get(0).unwrap(), (a, s(&t.env, "US"), 750));
}

#[test]
fn list_thresholds_empty_by_default() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin, None::<u64>));
    let c = ComplyRailClient::new(&env, &id);
    assert_eq!(c.list_thresholds().len(), 0);
}

// ----- paginated payment reads ---------------------------------------------

/// Submits `n` below-threshold payments from vasp_a to vasp_b (ids 0..n).
fn submit_many(t: &Setup, n: u32) {
    for _ in 0..n {
        t.client
            .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &100);
    }
}

#[test]
fn list_payments_empty_contract() {
    let t = setup();
    assert_eq!(t.client.list_payments(&0, &10).len(), 0);
    assert_eq!(t.client.list_payments_by_vasp(&t.vasp_a, &0, &10).len(), 0);
}

#[test]
fn list_payments_partial_last_page() {
    let t = setup();
    submit_many(&t, 3);
    let first = t.client.list_payments(&0, &2);
    assert_eq!(first.len(), 2);
    assert_eq!(first.get(0).unwrap().id, 0);
    assert_eq!(first.get(1).unwrap().id, 1);
    let last = t.client.list_payments(&2, &2);
    assert_eq!(last.len(), 1);
    assert_eq!(last.get(0).unwrap().id, 2);
}

#[test]
fn list_payments_start_past_end_and_zero_limit_are_empty() {
    let t = setup();
    submit_many(&t, 2);
    assert_eq!(t.client.list_payments(&2, &10).len(), 0);
    assert_eq!(t.client.list_payments(&99, &10).len(), 0);
    assert_eq!(t.client.list_payments(&0, &0).len(), 0);
}

#[test]
fn list_payments_caps_limit_at_max_page_size() {
    let t = setup();
    submit_many(&t, 55);
    assert_eq!(t.client.list_payments(&0, &1_000).len(), MAX_PAGE_SIZE);
    assert_eq!(t.client.list_payments(&50, &1_000).len(), 5);
}

#[test]
fn list_payments_by_vasp_indexes_both_sides() {
    let t = setup();
    StellarAssetClient::new(&t.env, &t.token.address).mint(&t.vasp_b, &10_000);
    submit_many(&t, 2); // ids 0, 1: a -> b
    t.client
        .submit_payment(&t.vasp_b, &t.vasp_a, &t.beneficiary, &t.token.address, &100); // id 2
    let from_a = t.client.list_payments_by_vasp(&t.vasp_a, &0, &10);
    assert_eq!(from_a.len(), 3);
    assert_eq!(from_a.get(0).unwrap().id, 0);
    assert_eq!(from_a.get(1).unwrap().id, 1);
    assert_eq!(from_a.get(2).unwrap().id, 2);
    let to_b = t.client.list_payments_by_vasp(&t.vasp_b, &0, &10);
    assert_eq!(to_b.len(), 3);
    assert_eq!(to_b.get(0).unwrap().id, 0);
}

#[test]
fn list_payments_by_vasp_paginates_its_own_index() {
    let t = setup();
    submit_many(&t, 5);
    let page = t.client.list_payments_by_vasp(&t.vasp_b, &2, &2);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap().id, 2);
    assert_eq!(page.get(1).unwrap().id, 3);
    let tail = t.client.list_payments_by_vasp(&t.vasp_b, &4, &2);
    assert_eq!(tail.len(), 1);
    assert_eq!(tail.get(0).unwrap().id, 4);
}

#[test]
fn list_payments_by_vasp_unknown_vasp_is_empty() {
    let t = setup();
    submit_many(&t, 1);
    assert_eq!(
        t.client
            .list_payments_by_vasp(&Address::generate(&t.env), &0, &10)
            .len(),
        0
    );
}
