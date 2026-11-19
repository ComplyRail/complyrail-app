#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Events as _, xdr};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String, TryFromVal,
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
