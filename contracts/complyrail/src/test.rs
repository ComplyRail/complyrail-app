#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Events as _, xdr};
use soroban_sdk::{panic_with_error, symbol_short};
use soroban_sdk::{
    testutils::{
        storage::Instance as _, storage::Persistent as _, Address as _, Ledger, MockAuth, MockAuthInvoke,
    },
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Event, IntoVal, String, TryFromVal, Val,
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
    client.set_asset_allowed(&token_addr, &true);

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
    c.set_asset_allowed(&sac.address(), &true);
    c.register_vasp(&a, &s(&env, "A"), &s(&env, "US"), &key(&env, 1), &None);
    c.register_vasp(&b, &s(&env, "B"), &s(&env, "GB"), &key(&env, 2), &None);
    let pid = c.submit_payment(&a, &b, &Address::generate(&env), &sac.address(), &10, &None);
    assert_eq!(c.get_payment(&pid).expires_at, 560);
}

#[test]
fn constructor_accepts_max_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    StellarAssetClient::new(&env, &sac.address()).mint(&a, &100);
    let id = env.register(ComplyRail, (admin, Address::generate(&env), Some(MAX_CONSTRUCTOR_TTL)));
    let c = ComplyRailClient::new(&env, &id);
    c.set_asset_allowed(&sac.address(), &true);
    c.register_vasp(&a, &s(&env, "A"), &s(&env, "US"), &key(&env, 1), &None);
    c.register_vasp(&b, &s(&env, "B"), &s(&env, "GB"), &key(&env, 2), &None);
    let pid = c.submit_payment(&a, &b, &Address::generate(&env), &sac.address(), &10, &None);
    assert_eq!(c.get_payment(&pid).expires_at, 1_000 + MAX_CONSTRUCTOR_TTL);
}

#[test]
#[should_panic(expected = "Error(Contract, #35)")]
fn constructor_rejects_u64_max_ttl() {
    let env = Env::default();
    let admin = Address::generate(&env);
    env.register(ComplyRail, (admin, Address::generate(&env), Some(u64::MAX)));
}

#[test]
fn submit_payment_rejects_expiry_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(u64::MAX - 10);
    let admin = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    StellarAssetClient::new(&env, &sac.address()).mint(&a, &100);
    let id = env.register(ComplyRail, (admin, Address::generate(&env), Some(MAX_CONSTRUCTOR_TTL)));
    let c = ComplyRailClient::new(&env, &id);
    c.set_asset_allowed(&sac.address(), &true);
    c.register_vasp(&a, &s(&env, "A"), &s(&env, "US"), &key(&env, 1), &None);
    c.register_vasp(&b, &s(&env, "B"), &s(&env, "GB"), &key(&env, 2), &None);
    let r = c.try_submit_payment(&a, &b, &Address::generate(&env), &sac.address(), &10, &None);
    assert_eq!(r, Err(Ok(Error::ExpiryOverflow)));
    assert_eq!(c.payment_count(), 0);
}

fn long(env: &Env, len: usize) -> String {
    // no_std: slice a fixed buffer (longest limit used here is 257 bytes)
    String::from_bytes(env, &[b'a'; 300][..len])
}

#[test]
fn register_vasp_enforces_length_limits() {
    let t = setup();
    let who = Address::generate(&t.env);
    let r = t.client.try_register_vasp(
        &who,
        &long(&t.env, MAX_NAME_LEN as usize + 1),
        &s(&t.env, "US"),
        &key(&t.env, 3),
        &None,
    );
    assert_eq!(r, Err(Ok(Error::InvalidInput)));
    let r = t.client.try_register_vasp(
        &who,
        &s(&t.env, "Name"),
        &long(&t.env, MAX_JURISDICTION_LEN as usize + 1),
        &key(&t.env, 3),
        &None,
    );
    assert_eq!(r, Err(Ok(Error::InvalidInput)));
    // exactly at the limit is accepted
    t.client.register_vasp(
        &who,
        &long(&t.env, MAX_NAME_LEN as usize),
        &s(&t.env, "US"),
        &key(&t.env, 3),
        &None,
    );
    assert!(t.client.is_vasp_active(&who));
}

#[test]
fn set_threshold_rejects_long_jurisdiction() {
    let t = setup();
    let r = t.client.try_set_threshold(
        &t.token.address,
        &long(&t.env, MAX_JURISDICTION_LEN as usize + 1),
        &100,
    );
    assert_eq!(r, Err(Ok(Error::InvalidInput)));
}

#[test]
fn submit_attestation_enforces_ivms_version_limit() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
        &None,
    );
    let r = t.client.try_submit_attestation(
        &id,
        &key(&t.env, 7),
        &long(&t.env, MAX_IVMS_VERSION_LEN as usize + 1),
    );
    assert_eq!(r, Err(Ok(Error::InvalidInput)));
    // still unattested, so a valid version can be recorded afterwards
    t.client.submit_attestation(
        &id,
        &key(&t.env, 7),
        &long(&t.env, MAX_IVMS_VERSION_LEN as usize),
    );
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
}

#[test]
fn reject_payment_enforces_reason_limit() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
        &None,
    );
    let r = t
        .client
        .try_reject_payment(&id, &t.vasp_b, &long(&t.env, MAX_REASON_LEN as usize + 1), &None);
    assert_eq!(r, Err(Ok(Error::InvalidInput)));
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
    t.client
        .reject_payment(&id, &t.vasp_b, &long(&t.env, MAX_REASON_LEN as usize), &None);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Rejected);
}

#[test]
fn reject_payment_rejects_blank_reason() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
        &None,
    );
    assert_eq!(
        t.client.try_reject_payment(&id, &t.vasp_b, &s(&t.env, ""), &None),
        Err(Ok(Error::InvalidInput))
    );
    assert_eq!(
        t.client
            .try_reject_payment(&id, &t.vasp_b, &s(&t.env, "   \t\r\n "), &None),
        Err(Ok(Error::InvalidInput))
    );
    // a blank reason leaves the payment pending and the funds in escrow
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
    assert_eq!(t.token.balance(&t.client.address), 5_000);
    // surrounding whitespace around real text is fine
    t.client
        .reject_payment(&id, &t.vasp_b, &s(&t.env, "  name mismatch  "), &None);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Rejected);
}

#[test]
fn external_ref_round_trips_and_is_emitted() {
    let t = setup();
    let ext = key(&t.env, 0xEE);
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
        &Some(ext.clone()),
    );
    // `events()` only reports the most recent invocation, so check before any read call.
    let expected = PaymentSubmitted {
        id,
        from_vasp: t.vasp_a.clone(),
        to_vasp: t.vasp_b.clone(),
        amount: 5_000,
        beneficiary: t.beneficiary.clone(),
        asset: t.token.address.clone(),
        created_ledger: t.env.ledger().sequence(),
        requires_attestation: true,
        external_ref: Some(ext.clone()),
    }
    .to_xdr(&t.env, &t.client.address);
    assert!(t.env.events().all().events().contains(&expected));

    assert_eq!(t.client.get_payment(&id).external_ref, Some(ext));
}

#[test]
fn external_ref_is_optional() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &100,
        &None,
    );
    assert_eq!(t.client.get_payment(&id).external_ref, None);
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
    let id = env.register(ComplyRail, (admin.clone(), Address::generate(&env), None::<u64>));
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
    let r = t.client.try_submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &100,
        &None,
    );
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
    let r = t.client.try_submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &100,
        &None,
    );
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
            &amount, &None,
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
            .submit_payment(&sg_vasp, &t.vasp_b, &t.beneficiary, &token, &amount, &None);
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
        &None,
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
        &None,
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

    // beneficiary must acknowledge before releasing
    let r = t.client.try_release_payment(&id, &t.vasp_b);
    assert_eq!(r, Err(Ok(Error::AttestationNotAcknowledged)));
    t.client.acknowledge_attestation(&id);
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
fn acknowledge_requires_attestation_and_beneficiary_auth() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    // nothing to acknowledge yet
    assert_eq!(
        t.client.try_acknowledge_attestation(&id),
        Err(Ok(Error::AttestationRequired))
    );
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
    assert!(t.client.get_payment(&id).acknowledged_at.is_some());
    assert_eq!(
        t.client.try_acknowledge_attestation(&id),
        Err(Ok(Error::AlreadyAcknowledged))
    );
}

#[test]
fn acknowledge_is_signed_by_beneficiary_vasp() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
        &None,
    );
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
    // the only required signer must be the beneficiary VASP, not the originator
    let (signer, _) = t.env.auths().first().cloned().expect("auth recorded");
    assert_eq!(signer, t.vasp_b);
}

#[test]
fn amend_replaces_attestation_and_keeps_old_hash_in_event() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
        &None,
    );
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.env.ledger().set_timestamp(1_500);
    t.client
        .amend_attestation(&id, &key(&t.env, 9), &s(&t.env, "IVMS101.2025"));
    // capture events of the amend call before any further contract call
    let events = t.env.events().all();

    let contract = t.client.address.clone();
    let amended = AttestationAmended {
        id,
        old_hash: key(&t.env, 7),
        new_hash: key(&t.env, 9),
        ivms_version: s(&t.env, "IVMS101.2025"),
    };
    assert!(events.events().contains(&amended.to_xdr(&t.env, &contract)));

    let p = t.client.get_payment(&id);
    assert_eq!(p.attestation_hash, Some(key(&t.env, 9)));
    assert_eq!(p.ivms_version, Some(s(&t.env, "IVMS101.2025")));
    assert_eq!(p.attested_at, Some(1_500));
    assert_eq!(p.status, PaymentStatus::Pending);
}

#[test]
fn amend_requires_existing_attestation() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert_eq!(
        t.client
            .try_amend_attestation(&id, &key(&t.env, 9), &s(&t.env, "IVMS101.2025")),
        Err(Ok(Error::AttestationRequired))
    );
}

#[test]
fn amend_is_blocked_after_acknowledgement() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
    assert_eq!(
        t.client
            .try_amend_attestation(&id, &key(&t.env, 9), &s(&t.env, "IVMS101.2025")),
        Err(Ok(Error::AlreadyAcknowledged))
    );
    // the acknowledged hash is unchanged
    assert_eq!(
        t.client.get_payment(&id).attestation_hash,
        Some(key(&t.env, 7))
    );
}

#[test]
fn amend_is_signed_by_originator() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client
        .amend_attestation(&id, &key(&t.env, 9), &s(&t.env, "IVMS101.2025"));
    let (signer, _) = t.env.auths().first().cloned().expect("auth recorded");
    assert_eq!(signer, t.vasp_a);
}

#[test]
fn query_moves_pending_to_queried_and_blocks_release() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client
        .query_payment(&id, &s(&t.env, "originator name missing"));

    let contract = t.client.address.clone();
    let queried = PaymentQueried {
        id,
        reason: s(&t.env, "originator name missing"),
    };
    assert!(t
        .env
        .events()
        .all()
        .events()
        .contains(&queried.to_xdr(&t.env, &contract)));
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Queried);

    // a queried payment cannot be released until it is amended
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::PaymentNotPending))
    );
    assert_eq!(
        t.client.try_release_payment(&id, &t.admin),
        Err(Ok(Error::PaymentNotPending))
    );
    assert_eq!(t.token.balance(&t.beneficiary), 0);
}

#[test]
fn query_only_from_pending_and_not_after_ack() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
    assert_eq!(
        t.client.try_query_payment(&id, &s(&t.env, "late query")),
        Err(Ok(Error::AlreadyAcknowledged))
    );
    // the acknowledged payment is still Pending: the query was refused
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
}

#[test]
fn query_twice_is_rejected() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.query_payment(&id, &s(&t.env, "first"));
    assert_eq!(
        t.client.try_query_payment(&id, &s(&t.env, "second")),
        Err(Ok(Error::PaymentNotPending))
    );
}

#[test]
fn originator_amends_queried_payment_back_to_pending() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.query_payment(&id, &s(&t.env, "wrong payload"));
    t.client
        .amend_attestation(&id, &key(&t.env, 9), &s(&t.env, "IVMS101.2025"));

    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Pending);
    assert_eq!(p.attestation_hash, Some(key(&t.env, 9)));

    // the corrected attestation can now be acknowledged and released
    t.client.acknowledge_attestation(&id);
    t.client.release_payment(&id, &t.vasp_b);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Released);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
}

#[test]
fn beneficiary_can_reject_queried_payment() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.query_payment(&id, &s(&t.env, "unclear"));
    t.client
        .reject_payment(&id, &t.vasp_b, &s(&t.env, "giving up"), &None);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Rejected);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
}

#[test]
fn queried_payment_can_be_reclaimed_after_expiry() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.query_payment(&id, &s(&t.env, "unclear"));
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
}

#[test]
fn query_is_signed_by_beneficiary_vasp() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.query_payment(&id, &s(&t.env, "unclear"));
    let (signer, _) = t.env.auths().first().cloned().expect("auth recorded");
    assert_eq!(signer, t.vasp_b);
}

#[test]
fn release_fails_if_beneficiary_vasp_suspended_after_submit() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "test reason"));

    let r = t.client.try_release_payment(&id, &t.vasp_b);
    assert_eq!(r, Err(Ok(Error::VaspNotActive)));
    // admin override does not bypass the beneficiary status check
    let r = t.client.try_release_payment(&id, &t.admin);
    assert_eq!(r, Err(Ok(Error::VaspNotActive)));
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
}

#[test]
fn release_fails_if_beneficiary_vasp_revoked_or_expired() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.set_vasp_expiry(&t.vasp_b, &Some(2_000));
    t.env.ledger().set_timestamp(2_000);
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::VaspNotActive))
    );
}

#[test]
fn reject_refunds_originator() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
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
        &5_000, &None,
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
        &5_000, &None,
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
        &5_000, &None,
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
        &5_000, &None,
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
fn admin_override_without_ack_is_logged() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.release_payment(&id, &t.admin);

    let contract = t.client.address.clone();
    let expected = AcknowledgementOverridden {
        id,
        admin: t.admin.clone(),
    };
    assert!(t
        .env
        .events()
        .all()
        .events()
        .contains(&expected.to_xdr(&t.env, &contract)));
}

#[test]
fn admin_release_after_ack_is_not_an_override() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
    t.client.release_payment(&id, &t.admin);

    let contract = t.client.address.clone();
    let override_evt = AcknowledgementOverridden {
        id,
        admin: t.admin.clone(),
    };
    assert!(!t
        .env
        .events()
        .all()
        .events()
        .contains(&override_evt.to_xdr(&t.env, &contract)));
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
        &None,
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
fn reclaim_emits_reclaimed_event_not_rejected() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);

    // Only this contract's events: the token contract emits its own transfer events.
    let contract_id = t.client.address.clone();
    let emitted = t.env.events().all().filter_by_contract(&contract_id);
    let expected = PaymentReclaimed { id, amount: 5_000 }.to_xdr(&t.env, &contract_id);
    // The reclaim emits exactly one event, and it is pay_recl. No pay_rej, so the
    // audit log can't label a reclaimed payment as rejected.
    assert_eq!(emitted.events(), &[expected][..]);
}

#[test]
fn invalid_payments_rejected() {
    let t = setup();
    let a = &t.token.address;
    assert_eq!(
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &0, &None),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_a, &t.beneficiary, a, &10, &None),
        Err(Ok(Error::SameVasp))
    );
    let stranger = Address::generate(&t.env);
    assert_eq!(
        t.client
            .try_submit_payment(&stranger, &t.vasp_b, &t.beneficiary, a, &10, &None),
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
            .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &10, &None),
        0
    );
    assert_eq!(
        t.client
            .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &10, &None),
        1
    );
    assert_eq!(t.client.payment_count(), 2);
}

#[test]
fn uncovered_jurisdiction_requires_attestation() {
    let t = setup();
    // vasp_b is GB and there is no GB or "*" rule -> threshold 0 -> held
    StellarAssetClient::new(&t.env, &t.token.address).mint(&t.vasp_b, &100);
    let id = t.client.submit_payment(
        &t.vasp_b,
        &t.vasp_a,
        &t.beneficiary,
        &t.token.address,
        &1,
        &None,
    );
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
        &5_000, &None,
)
}

#[test]
fn release_blocked_after_beneficiary_vasp_suspended() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    t.client
        .set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "test reason"));
    assert!(!t.client.is_vasp_active(&t.vasp_b));

    // Release re-checks the beneficiary VASP, so a suspended receiver blocks it.
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::VaspNotActive))
    );
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
    assert_eq!(t.token.balance(&t.client.address), 5_000);
}

#[test]
fn release_blocked_after_beneficiary_vasp_expires() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    t.client.set_vasp_expiry(&t.vasp_b, &Some(2_000));
    t.env.ledger().set_timestamp(2_000);
    assert!(!t.client.is_vasp_active(&t.vasp_b));

    // Release re-checks the beneficiary VASP, so an expired receiver blocks it.
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::VaspNotActive))
    );
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
    assert_eq!(t.token.balance(&t.client.address), 5_000);
}

// ----- races around payment expiry (#63) -----------------------------------

#[test]
fn release_at_expiry_is_refused_and_reclaim_settles() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    let expires_at = t.client.get_payment(&id).expires_at;
    t.env.ledger().set_timestamp(expires_at);

    // The release window closes exactly at expires_at; only reclaim can settle now.
    t.client.acknowledge_attestation(&id);
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::PaymentExpired))
    );
    t.client.reclaim_expired(&id);
    // A release after the reclaim finds the payment no longer pending.
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::PaymentNotPending))
    );

    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
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
fn attest_at_expiry_is_refused_and_payment_stays_pending() {
    let t = setup();
    let id = submit_held(&t);
    let expires_at = t.client.get_payment(&id).expires_at;
    t.env.ledger().set_timestamp(expires_at);

    assert_eq!(
        t.client
            .try_submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023")),
        Err(Ok(Error::PaymentExpired))
    );
    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Pending);
    assert_eq!(p.attestation_hash, None);
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
/// `admin` to `new_admin` in two steps: propose, then accept. Each step mocks
/// only the signature it needs.
fn env_after_admin_transfer() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let threshold_admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin.clone(), threshold_admin.clone(), None::<u64>));

    let propose_args: soroban_sdk::Vec<soroban_sdk::Val> = (new_admin.clone(),).into_val(&env);
    let proposal = MockAuthInvoke {
        contract: &id,
        fn_name: "propose_admin",
        args: propose_args,
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &proposal,
    }]);
    ComplyRailClient::new(&env, &id).propose_admin(&new_admin);

    let accept_args: soroban_sdk::Vec<soroban_sdk::Val> = (new_admin.clone(),).into_val(&env);
    let accept = MockAuthInvoke {
        contract: &id,
        fn_name: "accept_admin",
        args: accept_args,
        sub_invokes: &[],
    };
    env.mock_auths(&[MockAuth {
        address: &new_admin,
        invoke: &accept,
    }]);
    ComplyRailClient::new(&env, &id).accept_admin(&new_admin);
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
        &5_000, &None,
);
    let reason = s(&t.env, "beneficiary name mismatch");
    t.client
        .reject_payment(&id, &t.vasp_b, &reason, &Some(key(&t.env, 9)));
    assert_last_event(
        &t,
        &PaymentRejected {
            id,
            asset: t.token.address.clone(),
            reason,
            evidence_hash: Some(key(&t.env, 9)),
            resolved_ledger: t.env.ledger().sequence(),
                    by: t.vasp_b.clone(),
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
fn accept_admin_emits_adm_acc() {
    use soroban_sdk::{testutils::Events, Event};
    let t = setup();
    let new_admin = Address::generate(&t.env);
    t.client.propose_admin(&new_admin);
    t.client.accept_admin(&new_admin);

    let expected = AdminAccepted {
        previous: t.admin.clone(),
        new_admin: new_admin.clone(),
    }
    .to_xdr(&t.env, &t.client.address);
    let events = t.env.events().all();
    assert!(
        events.events().contains(&expected),
        "adm_acc event with previous and new admin should be emitted"
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
        &5_000, &None,
);
    let reason = s(&t.env, "duplicate");
    t.client.reject_payment(&id, &t.vasp_b, &reason, &None);
    assert_last_event(
        &t,
        &PaymentRejected {
            id,
            asset: t.token.address.clone(),
            reason,
            evidence_hash: None,
            resolved_ledger: t.env.ledger().sequence(),
                    by: t.vasp_b.clone(),
        },
    );
}

#[test]
fn expiry_reclaim_emits_pay_recl() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);
    assert_last_event(
        &t,
        &PaymentReclaimed {
            id,
            amount: 5_000,
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
        &5_000, &None,
);
    let before = t.client.get_payment(&id);

    t.client.rotate_vasp_key(&t.vasp_b, &key(&t.env, 6));
    t.client.rotate_vasp_key(&t.vasp_a, &key(&t.env, 7));

    assert_eq!(t.client.get_payment(&id), before);

    // the in-flight payment still settles between the same parties
    t.client
        .submit_attestation(&id, &key(&t.env, 8), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
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
        &100, &None,
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
    let id = env.register(ComplyRail, (admin.clone(), Address::generate(&env), None::<u64>));
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
        &5_000, &None,
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
    t.client.acknowledge_attestation(&held);
    t.client.release_payment(&held, &t.vasp_b);
    assert_eq!(t.client.get_payment(&held).status, PaymentStatus::Released);

    // a payment submitted after the change is judged under GB
    let fresh = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
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
    let id = env.register(ComplyRail, (admin.clone(), Address::generate(&env), None::<u64>));
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

// ----- inactive receiver handling (issue #33) -----------------------------

#[test]
fn originator_reclaims_when_receiver_revoked_before_expiry() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert_eq!(t.token.balance(&t.vasp_a), 995_000);
    t.client.set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &s(&t.env, "test reason"));

    t.client.reclaim_inactive(&id);

    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
}

#[test]
fn reclaim_inactive_rejected_while_receiver_active() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    let r = t.client.try_reclaim_inactive(&id);
    assert_eq!(r, Err(Ok(Error::ReceiverStillActive)));
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
}

#[test]
fn admin_refunds_pending_for_inactive_vasp_in_batches() {
    let t = setup();
    let token = t.token.address.clone();
    // Three held payments to vasp_b, one below threshold that settles at once.
    for _ in 0..3 {
        t.client
            .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &5_000, &None);
    }
    let settled = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &100, &None);
    t.client.set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &s(&t.env, "test reason"));

    let next = t.client.refund_pending_for_vasp(&t.vasp_b, &0, &2);
    assert_eq!(next, 2);
    assert_eq!(t.client.get_payment(&0).status, PaymentStatus::Rejected);
    assert_eq!(t.client.get_payment(&1).status, PaymentStatus::Rejected);
    assert_eq!(t.client.get_payment(&2).status, PaymentStatus::Pending);

    let next = t.client.refund_pending_for_vasp(&t.vasp_b, &next, &2);
    assert_eq!(next, 4);
    assert_eq!(t.client.get_payment(&2).status, PaymentStatus::Rejected);
    assert_eq!(t.client.get_payment(&settled).status, PaymentStatus::Released);
    // Only the settled 100 remains with the beneficiary; all held funds returned.
    assert_eq!(t.token.balance(&t.beneficiary), 100);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000 - 100);
}

#[test]
fn refund_batch_limits_enforced() {
    let t = setup();
    t.client.set_vasp_status(&t.vasp_b, &VaspStatus::Revoked, &s(&t.env, "test reason"));
    let too_big = t.client.try_refund_pending_for_vasp(&t.vasp_b, &0, &(MAX_REFUND_BATCH + 1));
    assert_eq!(too_big, Err(Ok(Error::BatchTooLarge)));

    let t2 = setup();
    let active = t2.client.try_refund_pending_for_vasp(&t2.vasp_b, &0, &10);
    assert_eq!(active, Err(Ok(Error::ReceiverStillActive)));
}

// ----- per-VASP escrow exposure cap (issue #34) ---------------------------

#[test]
fn exposure_cap_blocks_payments_over_limit() {
    let t = setup();
    let token = t.token.address.clone();
    t.client.set_exposure_cap(&t.vasp_a, &token, &10_000);
    assert_eq!(t.client.get_exposure_cap(&t.vasp_a, &token), Some(10_000));

    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &5_000, &None);
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &5_000, &None);
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 10_000);

    let r = t
        .client
        .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &3_000, &None);
    assert_eq!(r, Err(Ok(Error::ExposureCapExceeded)));
    // Rejected payment leaves funds and exposure untouched.
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 10_000);
    assert_eq!(t.token.balance(&t.vasp_a), 990_000);
}

#[test]
fn exposure_released_after_rejection() {
    let t = setup();
    let token = t.token.address.clone();
    t.client.set_exposure_cap(&t.vasp_a, &token, &5_000);
    let id = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &5_000, &None);
    assert_eq!(
        t.client.try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &3_000, &None),
        Err(Ok(Error::ExposureCapExceeded))
    );

    t.client
        .reject_payment(&id, &t.vasp_b, &s(&t.env, "bad data"), &None);
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 0);
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &5_000, &None);
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 5_000);
}

#[test]
fn exposure_released_after_release_and_reclaim() {
    let t = setup();
    let token = t.token.address.clone();
    t.client.set_exposure_cap(&t.vasp_a, &token, &6_000);
    let released = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &4_000, &None);
    t.client
        .submit_attestation(&released, &key(&t.env, 7), &s(&t.env, "2020"));
    t.client.acknowledge_attestation(&released);
    t.client.release_payment(&released, &t.vasp_b);
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 0);

    let expired = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &6_000, &None);
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 6_000);
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL + 1);
    t.client.reclaim_expired(&expired);
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 0);
}

#[test]
fn below_threshold_payments_do_not_count_towards_cap() {
    let t = setup();
    let token = t.token.address.clone();
    t.client.set_exposure_cap(&t.vasp_a, &token, &0);
    // Zero cap blocks any held payment, but immediate settlements pass.
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &100, &None);
    assert_eq!(t.client.get_exposure(&t.vasp_a, &token), 0);
    assert_eq!(
        t.client.try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &5_000, &None),
        Err(Ok(Error::ExposureCapExceeded))
    );
}

#[test]
fn negative_exposure_cap_rejected() {
    let t = setup();
    let token = t.token.address.clone();
    let r = t.client.try_set_exposure_cap(&t.vasp_a, &token, &-1);
    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
    assert_eq!(t.client.get_exposure_cap(&t.vasp_a, &token), None);
}

// ----- ledger sequence on payments (issue #35) ----------------------------

#[test]
fn payments_record_created_and_resolved_ledger() {
    let t = setup();
    let token = t.token.address.clone();
    t.env.ledger().set_sequence_number(500);
    let held = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &5_000, &None);
    let p = t.client.get_payment(&held);
    assert_eq!(p.created_ledger, 500);
    assert_eq!(p.resolved_ledger, None);

    t.env.ledger().set_sequence_number(525);
    t.client
        .reject_payment(&held, &t.vasp_b, &s(&t.env, "no"), &None);
    let p = t.client.get_payment(&held);
    assert_eq!(p.resolved_ledger, Some(525));
    assert_eq!(p.created_ledger, 500);
}

#[test]
fn immediate_settlement_records_both_ledgers() {
    let t = setup();
    let token = t.token.address.clone();
    t.env.ledger().set_sequence_number(900);
    let id = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &100, &None);
    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Released);
    assert_eq!(p.created_ledger, 900);
    assert_eq!(p.resolved_ledger, Some(900));
}

// ----- minimum payment amount (issue #36) ---------------------------------

#[test]
fn min_amount_boundary() {
    let t = setup();
    let token = t.token.address.clone();
    t.client.set_min_amount(&token, &1_000);
    assert_eq!(t.client.get_min_amount(&token), 1_000);

    let below = t
        .client
        .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &999, &None);
    assert_eq!(below, Err(Ok(Error::BelowMinAmount)));
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);

    // Exactly the minimum is accepted.
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &1_000, &None);
    assert_eq!(t.token.balance(&t.vasp_a), 999_000);
}

#[test]
fn min_amount_is_per_asset() {
    let t = setup();
    let token = t.token.address.clone();
    let other = t
        .env
        .register_stellar_asset_contract_v2(Address::generate(&t.env))
        .address();
    StellarAssetClient::new(&t.env, &other).mint(&t.vasp_a, &10_000);
    t.client.set_asset_allowed(&other, &true);
    t.client.set_min_amount(&token, &1_000);

    // The other asset has no minimum, so a 1 stroop payment passes.
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &other, &1, &None);
    assert_eq!(t.client.get_min_amount(&other), 0);
}

#[test]
fn zero_min_amount_accepts_any_positive_amount() {
    let t = setup();
    let token = t.token.address.clone();
    t.client.set_min_amount(&token, &1_000);
    t.client.set_min_amount(&token, &0);
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &token, &1, &None);
}

#[test]
fn negative_min_amount_rejected() {
    let t = setup();
    let token = t.token.address.clone();
    let r = t.client.try_set_min_amount(&token, &-5);
    assert_eq!(r, Err(Ok(Error::InvalidAmount)));
    assert_eq!(t.client.get_min_amount(&token), 0);
}

// ----- per-VASP payment index ----------------------------------------------

fn submit_small(t: &Setup, from: &Address, to: &Address) -> u64 {
    // 10 is below the 3_000 US threshold, so these settle immediately.
    t.client
        .submit_payment(from, to, &t.beneficiary, &t.token.address, &10, &None)
}

#[test]
fn vasp_index_lists_both_sides_in_submission_order() {
    let t = setup();
    let p0 = submit_small(&t, &t.vasp_a, &t.vasp_b);
    let p1 = submit_small(&t, &t.vasp_a, &t.vasp_b);
    let p2 = submit_small(&t, &t.vasp_a, &t.vasp_b);

    let expected = soroban_sdk::vec![&t.env, p0, p1, p2];
    assert_eq!(t.client.payments_for_vasp(&t.vasp_a, &0, &10), expected);
    assert_eq!(t.client.payments_for_vasp(&t.vasp_b, &0, &10), expected);
}

#[test]
fn vasp_index_is_empty_for_unrelated_vasp() {
    let t = setup();
    submit_small(&t, &t.vasp_a, &t.vasp_b);
    let stranger = Address::generate(&t.env);
    assert_eq!(
        t.client.payments_for_vasp(&stranger, &0, &10),
        soroban_sdk::vec![&t.env]
    );
}

#[test]
fn vasp_index_paging_respects_start_and_limit() {
    let t = setup();
    let mut ids = Vec::new(&t.env);
    for _ in 0..5 {
        ids.push_back(submit_small(&t, &t.vasp_a, &t.vasp_b));
    }
    let all = ids.clone();

    assert_eq!(
        t.client.payments_for_vasp(&t.vasp_a, &1, &2),
        soroban_sdk::vec![&t.env, ids.get(1).unwrap(), ids.get(2).unwrap()]
    );
    // Last page is shorter than the limit.
    assert_eq!(
        t.client.payments_for_vasp(&t.vasp_a, &4, &10),
        soroban_sdk::vec![&t.env, ids.get(4).unwrap()]
    );
    // Start past the end and zero limit both give an empty page.
    assert_eq!(
        t.client.payments_for_vasp(&t.vasp_a, &5, &10),
        soroban_sdk::vec![&t.env]
    );
    assert_eq!(
        t.client.payments_for_vasp(&t.vasp_a, &0, &0),
        soroban_sdk::vec![&t.env]
    );
    // Paging through everything reproduces the full list.
    let mut paged = Vec::new(&t.env);
    let mut start = 0;
    loop {
        let page = t.client.payments_for_vasp(&t.vasp_a, &start, &2);
        if page.is_empty() {
            break;
        }
        for id in page.iter() {
            paged.push_back(id);
        }
        start += 2;
    }
    assert_eq!(paged, all);
}

#[test]
fn vasp_index_page_size_is_capped() {
    let t = setup();
    for _ in 0..(MAX_PAGE_SIZE + 5) {
        submit_small(&t, &t.vasp_a, &t.vasp_b);
    }
    let page = t.client.payments_for_vasp(&t.vasp_a, &0, &u32::MAX);
    assert_eq!(page.len(), MAX_PAGE_SIZE);
    let tail = t
        .client
        .payments_for_vasp(&t.vasp_a, &MAX_PAGE_SIZE, &u32::MAX);
    assert_eq!(tail.len(), 5);
}

// ----- pending payments index ----------------------------------------------

#[test]
fn pending_index_holds_only_escrowed_payments() {
    let t = setup();
    let held = submit_held(&t);
    // Below threshold: settles immediately and never enters the queue.
    submit_small(&t, &t.vasp_a, &t.vasp_b);
    let held2 = submit_held(&t);

    assert_eq!(
        t.client.list_pending(&0, &10),
        soroban_sdk::vec![&t.env, held, held2]
    );
}

#[test]
fn pending_index_drops_on_release() {
    let t = setup();
    let id = submit_held(&t);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    // Attestation alone does not resolve the payment, so it stays queued.
    assert_eq!(
        t.client.list_pending(&0, &10),
        soroban_sdk::vec![&t.env, id]
    );

    t.client.acknowledge_attestation(&id);
    t.client.release_payment(&id, &t.vasp_b);
    assert_eq!(t.client.list_pending(&0, &10), soroban_sdk::vec![&t.env]);
}

#[test]
fn pending_index_drops_on_reject() {
    let t = setup();
    let keep = submit_held(&t);
    let drop = submit_held(&t);
    t.client
        .reject_payment(&drop, &t.vasp_b, &s(&t.env, "sanctions hit"), &None);
    assert_eq!(
        t.client.list_pending(&0, &10),
        soroban_sdk::vec![&t.env, keep]
    );
}

#[test]
fn pending_index_drops_on_reclaim() {
    let t = setup();
    let id = submit_held(&t);
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);
    assert_eq!(t.client.list_pending(&0, &10), soroban_sdk::vec![&t.env]);
}

#[test]
fn pending_index_paging_and_bounds() {
    let t = setup();
    let mut ids = Vec::new(&t.env);
    for _ in 0..4 {
        ids.push_back(submit_held(&t));
    }
    assert_eq!(
        t.client.list_pending(&1, &2),
        soroban_sdk::vec![&t.env, ids.get(1).unwrap(), ids.get(2).unwrap()]
    );
    assert_eq!(t.client.list_pending(&4, &10), soroban_sdk::vec![&t.env]);
    assert_eq!(t.client.list_pending(&0, &0), soroban_sdk::vec![&t.env]);
    assert_eq!(
        t.client.list_pending(&0, &u32::MAX).len(),
        4,
        "limit is clamped, not rejected"
    );
}

// ----- attestation hash lookup ---------------------------------------------

#[test]
fn find_payment_by_attestation_returns_owner() {
    let t = setup();
    let id = submit_held(&t);
    assert_eq!(t.client.find_payment_by_attestation(&key(&t.env, 9)), None);

    t.client
        .submit_attestation(&id, &key(&t.env, 9), &s(&t.env, "IVMS101.2023"));
    assert_eq!(
        t.client.find_payment_by_attestation(&key(&t.env, 9)),
        Some(id)
    );
    assert_eq!(t.client.find_payment_by_attestation(&key(&t.env, 8)), None);
}

#[test]
fn duplicate_attestation_hash_keeps_first_owner() {
    let t = setup();
    let first = submit_held(&t);
    let second = submit_held(&t);

    // Same IVMS101 hash recorded on two different payments.
    t.client
        .submit_attestation(&first, &key(&t.env, 5), &s(&t.env, "IVMS101.2023"));
    t.client
        .submit_attestation(&second, &key(&t.env, 5), &s(&t.env, "IVMS101.2023"));

    // Lookup still points at the first payment; the second keeps its own hash.
    assert_eq!(
        t.client.find_payment_by_attestation(&key(&t.env, 5)),
        Some(first)
    );
    assert_eq!(
        t.client.get_payment(&second).attestation_hash,
        Some(key(&t.env, 5))
    );
}

// ----- cancel --------------------------------------------------------------

#[test]
fn cancel_before_attestation_refunds_originator() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert_eq!(t.token.balance(&t.vasp_a), 995_000);

    t.client.cancel_payment(&id);

    let p = t.client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Cancelled);
    assert_eq!(p.resolved_at, Some(1_000));
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.token.balance(&t.client.address), 0);
    assert_eq!(t.token.balance(&t.beneficiary), 0);

    // a cancelled payment cannot be resolved again
    let r = t.client.try_cancel_payment(&id);
    assert_eq!(r, Err(Ok(Error::PaymentNotPending)));
    let r = t.client.try_release_payment(&id, &t.vasp_b);
    assert_eq!(r, Err(Ok(Error::PaymentNotPending)));
}

#[test]
fn cancel_after_attestation_is_rejected() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    let r = t.client.try_cancel_payment(&id);
    assert_eq!(r, Err(Ok(Error::AlreadyAttested)));

    // funds stay in escrow and the payment can still be released
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
    assert_eq!(t.token.balance(&t.client.address), 5_000);
    t.client.acknowledge_attestation(&id);
    t.client.release_payment(&id, &t.vasp_b);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
}

#[test]
fn cancel_settled_payment_is_rejected() {
    let t = setup();
    // below threshold: already released at submission
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &2_999, &None,
);
    let r = t.client.try_cancel_payment(&id);
    assert_eq!(r, Err(Ok(Error::PaymentNotPending)));
    assert_eq!(t.token.balance(&t.beneficiary), 2_999);
}

// ----- transfer failures ---------------------------------------------------

/// Test-only token whose transfers panic when the recipient is the blocked
/// address. This stands in for a recipient with no trustline on the asset.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum BlockingError {
    NoTrustline = 1,
}

#[contract]
struct BlockingToken;

#[contractimpl]
impl BlockingToken {
    pub fn block(env: Env, who: Address) {
        env.storage().instance().set(&symbol_short!("blocked"), &who);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .instance()
            .get::<_, i128>(&(symbol_short!("bal"), id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if let Some(blocked) = env
            .storage()
            .instance()
            .get::<_, Address>(&symbol_short!("blocked"))
        {
            if blocked == to {
                panic_with_error!(&env, BlockingError::NoTrustline);
            }
        }
        let from_key = (symbol_short!("bal"), from);
        let from_bal = env.storage().instance().get::<_, i128>(&from_key).unwrap_or(0);
        env.storage().instance().set(&from_key, &(from_bal - amount));
        let to_key = (symbol_short!("bal"), to);
        let to_bal = env.storage().instance().get::<_, i128>(&to_key).unwrap_or(0);
        env.storage().instance().set(&to_key, &(to_bal + amount));
    }
}

/// Registers the contract with a blocking token and two active VASPs, with a
/// threshold of 3_000 for the token.
fn blocking_setup<'a>(
    env: &'a Env,
    beneficiary: &Address,
) -> (ComplyRailClient<'a>, Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(env);
    let vasp_a = Address::generate(env);
    let vasp_b = Address::generate(env);
    let token = env.register(BlockingToken, ());
    BlockingTokenClient::new(env, &token).block(beneficiary);

    let id = env.register(ComplyRail, (admin, Address::generate(env), None::<u64>));
    let client = ComplyRailClient::new(env, &id);
    client.register_vasp(&vasp_a, &s(env, "Acme Exchange"), &s(env, "US"), &key(env, 1), &None);
    client.register_vasp(&vasp_b, &s(env, "Beta Finance"), &s(env, "GB"), &key(env, 2), &None);
    client.set_threshold(&token, &s(env, "US"), &3_000);
    client.set_asset_allowed(&token, &true);
    (client, vasp_a, vasp_b, token)
}

#[test]
fn submit_with_insufficient_balance_maps_to_transfer_failed() {
    let t = setup();
    // vasp_a holds 1_000_000, so this transfer cannot succeed.
    let r = t.client.try_submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &2_000_000, &None,
);
    assert_eq!(r, Err(Ok(Error::TransferFailed)));
    assert_eq!(t.client.payment_count(), 0);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
}

#[test]
fn settle_to_recipient_without_trustline_maps_to_transfer_failed() {
    let env = Env::default();
    let beneficiary = Address::generate(&env);
    let (client, vasp_a, vasp_b, token) = blocking_setup(&env, &beneficiary);

    // Below threshold: the payout to the beneficiary fails inside submit.
    let r = client.try_submit_payment(&vasp_a, &vasp_b, &beneficiary, &token, &2_999, &None);
    assert_eq!(r, Err(Ok(Error::TransferFailed)));
    assert_eq!(client.payment_count(), 0);
}

#[test]
fn release_to_recipient_without_trustline_keeps_payment_pending() {
    let env = Env::default();
    let beneficiary = Address::generate(&env);
    let (client, vasp_a, vasp_b, token) = blocking_setup(&env, &beneficiary);

    // Above threshold: escrow succeeds, the payout at release does not.
    let id = client.submit_payment(&vasp_a, &vasp_b, &beneficiary, &token, &5_000, &None);
    client.submit_attestation(&id, &key(&env, 7), &s(&env, "IVMS101.2023"));
    client.acknowledge_attestation(&id);

    let r = client.try_release_payment(&id, &vasp_b);
    assert_eq!(r, Err(Ok(Error::TransferFailed)));
    assert_eq!(client.get_payment(&id).status, PaymentStatus::Pending);
    assert_eq!(client.get_payment(&id).resolved_at, None);
}

// ----- events --------------------------------------------------------------
// `env.events().all()` reports only the most recent invocation, so each test
// asserts right after the call that emits the events.

/// The `(contract, topics, data)` tuple the host records for an event.
fn ev<E: Event>(t: &Setup, e: &E) -> (Address, Vec<Val>, Val) {
    (t.client.address.clone(), e.topics(&t.env), e.data(&t.env))
}

fn events_of(t: &Setup) -> soroban_sdk::testutils::ContractEvents {
    t.env.events().all().filter_by_contract(&t.client.address)
}

fn submitted(t: &Setup, id: u64, amount: i128, requires_attestation: bool) -> PaymentSubmitted {
    PaymentSubmitted {
        id,
        from_vasp: t.vasp_a.clone(),
        to_vasp: t.vasp_b.clone(),
        beneficiary: t.beneficiary.clone(),
        asset: t.token.address.clone(),
        amount,
        requires_attestation,
        created_ledger: t.env.ledger().sequence(),
            external_ref: None,
    }
}

#[test]
fn submit_below_threshold_events_are_self_describing() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &2_999, &None,
);
    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(&t, &submitted(&t, id, 2_999, false)));
    expected.push_back(ev(
        &t,
        &PaymentReleased {
            id,
            asset: t.token.address.clone(),
            amount: 2_999,
            resolved_ledger: t.env.ledger().sequence(),
                    by: t.vasp_a.clone(),
        },
    ));
    assert_eq!(events_of(&t), expected);
}

#[test]
fn submit_above_threshold_event_carries_asset_and_beneficiary() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(&t, &submitted(&t, id, 5_000, true)));
    assert_eq!(events_of(&t), expected);
}

#[test]
fn release_event_carries_asset() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
    t.client.release_payment(&id, &t.vasp_b);

    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(
        &t,
        &PaymentReleased {
            id,
            asset: t.token.address.clone(),
            amount: 5_000,
            resolved_ledger: t.env.ledger().sequence(),
                    by: t.vasp_b.clone(),
        },
    ));
    assert_eq!(events_of(&t), expected);
}

#[test]
fn reject_event_carries_asset() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client.reject_payment(&id, &t.vasp_b, &s(&t.env, "bad data"), &None);

    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(
        &t,
        &PaymentRejected {
            id,
            asset: t.token.address.clone(),
            reason: s(&t.env, "bad data"),
            evidence_hash: None,
            resolved_ledger: t.env.ledger().sequence(),
                    by: t.vasp_b.clone(),
        },
    ));
    assert_eq!(events_of(&t), expected);
}

#[test]
fn reclaim_event_carries_amount() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);

    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(
        &t,
        &PaymentReclaimed {
            id,
            amount: 5_000,
        },
    ));
    assert_eq!(events_of(&t), expected);
}

#[test]
fn cancel_event_carries_asset_and_amount() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client.cancel_payment(&id);

    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(
        &t,
        &PaymentCancelled {
            id,
            asset: t.token.address.clone(),
            amount: 5_000,
        },
    ));
    assert_eq!(events_of(&t), expected);
}

// ----- open payment limit --------------------------------------------------

fn submit_amount(t: &Setup, amount: i128) -> u64 {
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &amount, &None)
}

#[test]
fn default_open_limit_is_100() {
    let t = setup();
    assert_eq!(t.client.get_max_open_per_vasp(), DEFAULT_MAX_OPEN_PER_VASP);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 0);
}

#[test]
fn open_limit_blocks_extra_held_payments_without_moving_funds() {
    let t = setup();
    t.client.set_max_open_per_vasp(&2);
    assert_eq!(t.client.get_max_open_per_vasp(), 2);

    t.client.submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &5_000, &None);
    t.client.submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &5_000, &None);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 2);

    let r = t.client.try_submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert_eq!(r, Err(Ok(Error::OpenLimitReached)));
    assert_eq!(t.client.payment_count(), 2);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 2);
    assert_eq!(t.token.balance(&t.vasp_a), 990_000);

    // raising the limit lets the originator open more
    t.client.set_max_open_per_vasp(&3);
    t.client.submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &5_000, &None);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 3);
}

#[test]
fn zero_open_limit_is_rejected() {
    let t = setup();
    let r = t.client.try_set_max_open_per_vasp(&0);
    assert_eq!(r, Err(Ok(Error::InvalidLimit)));
    assert_eq!(t.client.get_max_open_per_vasp(), DEFAULT_MAX_OPEN_PER_VASP);
}

#[test]
fn below_threshold_payments_do_not_use_open_slots() {
    let t = setup();
    t.client.set_max_open_per_vasp(&1);
    t.client.submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &5_000, &None);

    // settles immediately, so it is not blocked by the held payment
    t.client.submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &2_999, &None);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 1);
    assert_eq!(t.token.balance(&t.beneficiary), 2_999);
}

#[test]
fn every_resolution_path_frees_an_open_slot() {
    let t = setup();
    t.client.set_max_open_per_vasp(&1);

    // cancel frees the slot
    let a = submit_amount(&t, 5_000);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 1);
    t.client.cancel_payment(&a);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 0);

    // reject frees the slot
    let b = submit_amount(&t, 5_000);
    t.client.reject_payment(&b, &t.vasp_b, &s(&t.env, "bad data"), &None);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 0);

    // release frees the slot
    let c = submit_amount(&t, 5_000);
    t.client
        .submit_attestation(&c, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&c);
    t.client.release_payment(&c, &t.vasp_b);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 0);

    // reclaim frees the slot
    let d = submit_amount(&t, 5_000);
    let r = t.client.try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &5_000, &None);
    assert_eq!(r, Err(Ok(Error::OpenLimitReached)));
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&d);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 0);
    submit_amount(&t, 5_000);
}

#[test]
fn resolving_an_already_resolved_payment_does_not_free_a_slot() {
    let t = setup();
    t.client.set_max_open_per_vasp(&2);
    let a = submit_amount(&t, 5_000);
    submit_amount(&t, 5_000);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 2);

    t.client.cancel_payment(&a);
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 1);

    // a second cancel fails and must not free another slot
    let r = t.client.try_cancel_payment(&a);
    assert_eq!(r, Err(Ok(Error::PaymentNotPending)));
    assert_eq!(t.client.open_payment_count(&t.vasp_a), 1);
}

// ----- fee-on-transfer tokens (issue #21) ----------------------------------

/// Minimal SEP-41-style token that keeps 10% of every transfer, so the
/// recipient receives less than `amount`.
#[contract]
pub struct FeeToken;

#[contracttype]
#[derive(Clone)]
enum FeeKey {
    Balance(Address),
}

#[contractimpl]
impl FeeToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let k = FeeKey::Balance(to);
        let b: i128 = env.storage().persistent().get(&k).unwrap_or(0);
        env.storage().persistent().set(&k, &(b + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&FeeKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let fee = amount / 10;
        let from_bal = Self::balance(env.clone(), from.clone());
        env.storage()
            .persistent()
            .set(&FeeKey::Balance(from), &(from_bal - amount));
        let to_bal = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&FeeKey::Balance(to), &(to_bal + amount - fee));
    }
}

#[test]
fn fee_on_transfer_asset_is_rejected() {
    let t = setup();
    let fee_id = t.env.register(FeeToken, ());
    let fee = FeeTokenClient::new(&t.env, &fee_id);
    fee.mint(&t.vasp_a, &1_000);
    // Allowlisted, so the call reaches the balance check.
    t.client.set_asset_allowed(&fee_id, &true);

    // 100 requested, 90 arrives: the escrow would be under-collateralised.
    let r = t
        .client
        .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &fee_id, &100, &None);
    assert_eq!(r, Err(Ok(Error::ReceivedAmountMismatch)));

    // The failed call must leave no trace: originator keeps its funds and
    // no payment was recorded.
    assert_eq!(fee.balance(&t.vasp_a), 1_000);
    assert_eq!(fee.balance(&t.client.address), 0);
    assert_eq!(t.client.payment_count(), 0);
}

#[test]
fn exact_transfer_asset_still_accepted() {
    let t = setup();
    // The standard Stellar asset delivers the full amount, so the balance
    // delta check passes and escrow holds exactly what was requested.
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert_eq!(t.client.get_payment(&id).amount, 5_000);
    assert_eq!(t.token.balance(&t.client.address), 5_000);
}

// ----- asset allowlist (issue #22) -----------------------------------------

#[test]
fn disallowed_asset_is_rejected() {
    let t = setup();
    let other = t
        .env
        .register_stellar_asset_contract_v2(Address::generate(&t.env))
        .address();
    StellarAssetClient::new(&t.env, &other).mint(&t.vasp_a, &1_000);
    assert!(!t.client.is_asset_allowed(&other));

    let r = t
        .client
        .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &other, &100, &None);
    assert_eq!(r, Err(Ok(Error::AssetNotAllowed)));
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
    assert_eq!(t.client.payment_count(), 0);
}

#[test]
fn allowlisted_asset_accepted_and_revocable() {
    let t = setup();
    assert!(t.client.is_asset_allowed(&t.token.address));
    t.client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &10, &None);
    assert_eq!(t.client.payment_count(), 1);

    t.client.set_asset_allowed(&t.token.address, &false);
    assert!(!t.client.is_asset_allowed(&t.token.address));
    let r =
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &10, &None);
    assert_eq!(r, Err(Ok(Error::AssetNotAllowed)));
}

#[test]
fn only_admin_can_set_allowlist() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(ComplyRail, (admin, Address::generate(&env), None::<u64>));
    let client = ComplyRailClient::new(&env, &id);
    // No mock_all_auths: the admin's auth is required and not provided.
    let r = client.try_set_asset_allowed(&sac.address(), &true);
    assert!(r.is_err());
    assert!(!client.is_asset_allowed(&sac.address()));
}

// ----- emergency pause (issue #23) -----------------------------------------

#[test]
fn pause_blocks_submit_and_release() {
    let t = setup();
    // A held payment created before the pause.
    let held = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&held, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    t.client.set_paused(&true);
    assert!(t.client.is_paused());

    // submit_payment is blocked and moves no tokens.
    let r =
        t.client
            .try_submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &10, &None);
    assert_eq!(r, Err(Ok(Error::Paused)));
    assert_eq!(t.client.payment_count(), 1);

    // release_payment is blocked even though the attestation is in place.
    let r = t.client.try_release_payment(&held, &t.vasp_b);
    assert_eq!(r, Err(Ok(Error::Paused)));
    assert_eq!(t.client.get_payment(&held).status, PaymentStatus::Pending);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
}

#[test]
fn pause_keeps_reject_and_reclaim_available() {
    let t = setup();
    let to_reject = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    let to_reclaim = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);

    t.client.set_paused(&true);

    // Funds can still be returned while paused.
    t.client
        .reject_payment(&to_reject, &t.vasp_b, &s(&t.env, "under investigation"), &None);
    assert_eq!(
        t.client.get_payment(&to_reject).status,
        PaymentStatus::Rejected
    );

    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&to_reclaim);
    assert_eq!(
        t.client.get_payment(&to_reclaim).status,
        PaymentStatus::Reclaimed
    );
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);
}

#[test]
fn unpause_restores_submit_and_release() {
    let t = setup();
    let held = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&held, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    t.client.set_paused(&true);
    t.client.set_paused(&false);
    assert!(!t.client.is_paused());

    let id = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &10, &None);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Released);
    t.client.acknowledge_attestation(&held);
    t.client.release_payment(&held, &t.vasp_b);
    assert_eq!(t.client.get_payment(&held).status, PaymentStatus::Released);
}

#[test]
fn only_admin_can_pause() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin, Address::generate(&env), None::<u64>));
    let client = ComplyRailClient::new(&env, &id);
    // No mock_all_auths: the admin's auth is required and not provided.
    assert!(client.try_set_paused(&true).is_err());
    assert!(!client.is_paused());
}

// ----- adjustable payment TTL (issue #24) ----------------------------------

#[test]
fn ttl_defaults_to_seven_days() {
    let t = setup();
    assert_eq!(t.client.payment_ttl(), DEFAULT_PAYMENT_TTL);
}

#[test]
fn ttl_bounds_are_enforced() {
    let t = setup();
    assert_eq!(
        t.client.try_set_payment_ttl(&(MIN_PAYMENT_TTL - 1)),
        Err(Ok(Error::InvalidTtl))
    );
    assert_eq!(
        t.client.try_set_payment_ttl(&(MAX_PAYMENT_TTL + 1)),
        Err(Ok(Error::InvalidTtl))
    );
    assert_eq!(t.client.try_set_payment_ttl(&0), Err(Ok(Error::InvalidTtl)));
    // The rejected values left the setting untouched.
    assert_eq!(t.client.payment_ttl(), DEFAULT_PAYMENT_TTL);

    // Both endpoints are inclusive.
    t.client.set_payment_ttl(&MIN_PAYMENT_TTL);
    assert_eq!(t.client.payment_ttl(), MIN_PAYMENT_TTL);
    t.client.set_payment_ttl(&MAX_PAYMENT_TTL);
    assert_eq!(t.client.payment_ttl(), MAX_PAYMENT_TTL);
}

#[test]
fn new_ttl_applies_only_to_new_payments() {
    let t = setup();
    // Created under the default 7-day TTL.
    let old = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    let old_expiry = t.client.get_payment(&old).expires_at;
    assert_eq!(old_expiry, 1_000 + DEFAULT_PAYMENT_TTL);

    // Shorten to 1 hour at t=2_000.
    t.env.ledger().set_timestamp(2_000);
    t.client.set_payment_ttl(&MIN_PAYMENT_TTL);

    // The existing payment keeps its original expiry.
    assert_eq!(t.client.get_payment(&old).expires_at, old_expiry);

    // A payment created after the change gets the new TTL.
    let new = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert_eq!(
        t.client.get_payment(&new).expires_at,
        2_000 + MIN_PAYMENT_TTL
    );

    // The old payment is still reclaimable only at its original expiry.
    t.env.ledger().set_timestamp(2_000 + MIN_PAYMENT_TTL);
    assert_eq!(
        t.client.try_reclaim_expired(&old),
        Err(Ok(Error::PaymentNotExpired))
    );
    t.client.reclaim_expired(&new);
    assert_eq!(t.client.get_payment(&new).status, PaymentStatus::Reclaimed);
}

#[test]
fn only_admin_can_set_ttl() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(ComplyRail, (admin, Address::generate(&env), None::<u64>));
    let client = ComplyRailClient::new(&env, &id);
    // No mock_all_auths: the admin's auth is required and not provided.
    assert!(client.try_set_payment_ttl(&MIN_PAYMENT_TTL).is_err());
    assert_eq!(client.payment_ttl(), DEFAULT_PAYMENT_TTL);
}

// ----- release window vs. reclaim window ----------------------------------

#[test]
fn release_allowed_just_before_expiry() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.env
        .ledger()
        .set_timestamp(1_000 + DEFAULT_PAYMENT_TTL - 1);
    t.client.acknowledge_attestation(&id);
    t.client.release_payment(&id, &t.vasp_b);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Released);
    assert_eq!(t.token.balance(&t.beneficiary), 5_000);
}

#[test]
fn release_rejected_at_and_after_expiry_and_reclaim_takes_over() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    // exactly at expiry: beneficiary release is closed, reclaim opens
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::PaymentExpired))
    );
    assert_eq!(
        t.client.try_release_payment(&id, &t.admin),
        Err(Ok(Error::PaymentExpired))
    );
    t.client.reclaim_expired(&id);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
    assert_eq!(t.token.balance(&t.beneficiary), 0);
    assert_eq!(t.token.balance(&t.vasp_a), 1_000_000);

    // a later release cannot double-settle the reclaimed payment
    t.env
        .ledger()
        .set_timestamp(1_000 + DEFAULT_PAYMENT_TTL + 60);
    assert_eq!(
        t.client.try_release_payment(&id, &t.vasp_b),
        Err(Ok(Error::PaymentNotPending))
    );
}

#[test]
fn attest_after_expiry_is_rejected_and_payment_stays_reclaimable() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    // one second before expiry the attestation is still accepted
    t.env
        .ledger()
        .set_timestamp(1_000 + DEFAULT_PAYMENT_TTL - 1);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    let p = t.client.get_payment(&id);
    assert_eq!(p.attestation_hash, Some(key(&t.env, 7)));

    // a second payment attested only after expiry must be refused
    let late = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.env
        .ledger()
        .set_timestamp(1_000 + 2 * DEFAULT_PAYMENT_TTL);
    let r = t
        .client
        .try_submit_attestation(&late, &key(&t.env, 9), &s(&t.env, "IVMS101.2023"));
    assert_eq!(r, Err(Ok(Error::PaymentExpired)));
    let p = t.client.get_payment(&late);
    assert_eq!(p.attestation_hash, None);
    assert_eq!(p.status, PaymentStatus::Pending);

    // the originator can still reclaim the late payment cleanly
    t.client.reclaim_expired(&late);
    assert_eq!(t.client.get_payment(&late).status, PaymentStatus::Reclaimed);
}

// ----- storage TTL: untouched payments must stay live until reclaim -------

/// Ledgers needed to cover `secs` of wall-clock time at 5 seconds per ledger.
fn ledgers_for(secs: u64) -> u32 {
    (secs / 5) as u32
}

/// Advance the ledger by one day without touching the contract, the way a
/// quiet network would.
fn advance_one_day(env: &Env) {
    env.ledger().with_mut(|li| {
        li.sequence_number += 17_280;
        li.timestamp += 86_400;
    });
}

/// Remaining live ledgers of a stored payment.
fn payment_ttl(env: &Env, contract: &Address, id: u64) -> u32 {
    env.as_contract(contract, || {
        env.storage().persistent().get_ttl(&DataKey::Payment(id))
    })
}

#[test]
fn untouched_payment_stays_live_until_expiry_with_long_ttl() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let admin = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = sac.address();
    StellarAssetClient::new(&env, &token).mint(&a, &10_000);
    let ttl_secs = 60 * 86_400u64;
    let id = env.register(ComplyRail, (admin.clone(), Address::generate(&env), Some(ttl_secs)));
    let c = ComplyRailClient::new(&env, &id);
    c.register_vasp(&a, &s(&env, "A"), &s(&env, "US"), &key(&env, 1), &None);
    c.register_vasp(&b, &s(&env, "B"), &s(&env, "GB"), &key(&env, 2), &None);
    c.set_threshold(&token, &s(&env, "US"), &1_000);
    c.set_asset_allowed(&token, &true);
    let pid = c.submit_payment(&a, &b, &Address::generate(&env), &token, &5_000, &None);

    // Right after submission the entry must outlive the payment's own TTL.
    assert!(payment_ttl(&env, &id, pid) >= ledgers_for(ttl_secs));
    assert!(env.as_contract(&id, || env.storage().instance().get_ttl()) >= ledgers_for(ttl_secs));

    // Let the whole TTL pass without any interaction; at every step the
    // remaining live window must still cover the time left until expiry.
    for _ in 0..60 {
        advance_one_day(&env);
        let left = ledgers_for(
            c.get_payment(&pid)
                .expires_at
                .saturating_sub(env.ledger().timestamp()),
        );
        assert!(payment_ttl(&env, &id, pid) >= left);
    }

    c.reclaim_expired(&pid);
    assert_eq!(c.get_payment(&pid).status, PaymentStatus::Reclaimed);
    assert_eq!(TokenClient::new(&env, &token).balance(&a), 10_000);
}

#[test]
fn untouched_default_payment_stays_live_until_expiry() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert!(payment_ttl(&t.env, &t.client.address, id) >= ledgers_for(DEFAULT_PAYMENT_TTL));
    for _ in 0..(DEFAULT_PAYMENT_TTL / 86_400) {
        advance_one_day(&t.env);
    }
    t.client.reclaim_expired(&id);
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Reclaimed);
}

// ----- audit: actor on release / reject events -----------------------------

// `events().all()` only reports the most recent invocation, so each assertion
// runs straight after the call it checks.
fn emitted_by(t: &Setup, event: &impl Event) -> bool {
    let xdr = event.to_xdr(&t.env, &t.client.address);
    t.env
        .events()
        .all()
        .filter_by_contract(&t.client.address)
        .events()
        .contains(&xdr)
}

#[test]
fn admin_override_release_is_distinguishable_from_beneficiary_release() {
    let t = setup();
    let a = &t.token.address;
    let by_admin = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &5_000, &None);
    let by_beneficiary = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &5_000, &None);
    for id in [by_admin, by_beneficiary] {
        t.client
            .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    }

    t.client.release_payment(&by_admin, &t.admin);
    assert!(emitted_by(
        &t,
        &PaymentReleased {
            id: by_admin,
            amount: 5_000,
            by: t.admin.clone(),
                    asset: t.token.address.clone(),
            resolved_ledger: t.env.ledger().sequence(),
        }
    ));
    assert!(!emitted_by(
        &t,
        &PaymentReleased {
            id: by_admin,
            amount: 5_000,
            by: t.vasp_b.clone(),
                    asset: t.token.address.clone(),
            resolved_ledger: t.env.ledger().sequence(),
        }
    ));

    t.client.acknowledge_attestation(&by_beneficiary);
    t.client.release_payment(&by_beneficiary, &t.vasp_b);
    assert!(emitted_by(
        &t,
        &PaymentReleased {
            id: by_beneficiary,
            amount: 5_000,
            by: t.vasp_b.clone(),
                    asset: t.token.address.clone(),
            resolved_ledger: t.env.ledger().sequence(),
        }
    ));
    assert!(!emitted_by(
        &t,
        &PaymentReleased {
            id: by_beneficiary,
            amount: 5_000,
            by: t.admin.clone(),
                    asset: t.token.address.clone(),
            resolved_ledger: t.env.ledger().sequence(),
        }
    ));
}

#[test]
fn reject_and_reclaim_events_are_distinct() {
    let t = setup();
    let a = &t.token.address;
    let rejected = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &5_000, &None);
    t.client
        .reject_payment(&rejected, &t.admin, &s(&t.env, "sanctions hit"), &None);
    assert!(emitted_by(
        &t,
        &PaymentRejected {
            id: rejected,
            reason: s(&t.env, "sanctions hit"),
            by: t.admin.clone(),
                    asset: t.token.address.clone(),
            resolved_ledger: t.env.ledger().sequence(),
            evidence_hash: None,
        }
    ));

    let reclaimed = t
        .client
        .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, a, &5_000, &None);
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&reclaimed);
    assert!(emitted_by(
        &t,
        &PaymentReclaimed {
            id: reclaimed,
            amount: 5_000,
        }
    ));
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
    let id = env.register(ComplyRail, (admin, Address::generate(&env), None::<u64>));
    let c = ComplyRailClient::new(&env, &id);
    assert_eq!(c.list_thresholds().len(), 0);
}

// ----- paginated payment reads ---------------------------------------------

/// Submits `n` below-threshold payments from vasp_a to vasp_b (ids 0..n).
fn submit_many(t: &Setup, n: u32) {
    for _ in 0..n {
        t.client
            .submit_payment(&t.vasp_a, &t.vasp_b, &t.beneficiary, &t.token.address, &100, &None);
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
    submit_many(&t, MAX_PAGE_SIZE + 5);
    assert_eq!(t.client.list_payments(&0, &1_000).len(), MAX_PAGE_SIZE);
    assert_eq!(t.client.list_payments(&(MAX_PAGE_SIZE as u64), &1_000).len(), 5);
}

#[test]
fn list_payments_by_vasp_indexes_both_sides() {
    let t = setup();
    StellarAssetClient::new(&t.env, &t.token.address).mint(&t.vasp_b, &10_000);
    submit_many(&t, 2); // ids 0, 1: a -> b
    t.client
        .submit_payment(&t.vasp_b, &t.vasp_a, &t.beneficiary, &t.token.address, &100, &None); // id 2
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

// ----- event assertions ----------------------------------------------------
//
// `env.events().all()` only holds the events of the most recent invocation,
// and includes token-contract events, so each check runs right after its call
// and is filtered down to this contract.

#[test]
fn register_vasp_emits_vasp_reg() {
    let t = setup();
    let new_vasp = Address::generate(&t.env);
    t.client.register_vasp(
        &new_vasp,
        &s(&t.env, "Gamma"),
        &s(&t.env, "SG"),
        &key(&t.env, 3),
        &None,
    );
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [VaspRegistered {
            address: new_vasp,
            jurisdiction: s(&t.env, "SG"),
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn set_vasp_status_emits_vasp_upd() {
    let t = setup();
    t.client.set_vasp_status(&t.vasp_b, &VaspStatus::Suspended, &s(&t.env, "test reason"));
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [VaspUpdated {
            address: t.vasp_b.clone(),
            status: VaspStatus::Suspended,
            expires_at: None,
            reason: s(&t.env, "test reason"),
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn set_vasp_expiry_emits_vasp_upd() {
    let t = setup();
    t.client.set_vasp_expiry(&t.vasp_a, &Some(2_000));
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [VaspUpdated {
            address: t.vasp_a.clone(),
            status: VaspStatus::Active,
            expires_at: Some(2_000),
            reason: s(&t.env, ""),
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn set_threshold_emits_thr_set() {
    let t = setup();
    let a = t.token.address.clone();
    t.client.set_threshold(&a, &s(&t.env, "GB"), &500);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [ThresholdSet {
            asset: a,
            jurisdiction: s(&t.env, "GB"),
            amount: 500,
            removed: false,
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn held_payment_emits_only_pay_sub() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [PaymentSubmitted {
            id,
            from_vasp: t.vasp_a.clone(),
            to_vasp: t.vasp_b.clone(),
            amount: 5_000,
            requires_attestation: true,
        
            asset: t.token.address.clone(),
            beneficiary: t.beneficiary.clone(),
            created_ledger: t.env.ledger().sequence(),
                external_ref: None,
    }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn instant_settlement_emits_pay_sub_then_pay_rel() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &2_999, &None,
);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [
            PaymentSubmitted {
                id,
                from_vasp: t.vasp_a.clone(),
                to_vasp: t.vasp_b.clone(),
                amount: 2_999,
                requires_attestation: false,
            
            asset: t.token.address.clone(),
            beneficiary: t.beneficiary.clone(),
            created_ledger: t.env.ledger().sequence(),
                external_ref: None,
    }
            .to_xdr(&t.env, &t.client.address),
            PaymentReleased {
                id,
                asset: t.token.address.clone(),
                amount: 2_999,
                resolved_ledger: t.env.ledger().sequence(),
                by: t.vasp_a.clone(),
            }
            .to_xdr(&t.env, &t.client.address),
        ]
    );
}

#[test]
fn submit_attestation_emits_att_sub() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [AttestationSubmitted {
            id,
            hash: key(&t.env, 7),
            ivms_version: s(&t.env, "IVMS101.2023"),
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn release_payment_emits_pay_rel() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.acknowledge_attestation(&id);
    t.client.release_payment(&id, &t.vasp_b);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [PaymentReleased {
            id,
            asset: t.token.address.clone(),
            amount: 5_000,
            resolved_ledger: t.env.ledger().sequence(),
            by: t.vasp_b.clone(),
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn reject_payment_emits_pay_rej_with_reason() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.client
        .reject_payment(&id, &t.vasp_b, &s(&t.env, "name mismatch"), &None);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [PaymentRejected {
            id,
            reason: s(&t.env, "name mismatch"),
        
            asset: t.token.address.clone(),
            resolved_ledger: t.env.ledger().sequence(),
            by: t.vasp_b.clone(),
            evidence_hash: None,
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn reclaim_expired_emits_pay_recl() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000, &None,
);
    t.env.ledger().set_timestamp(1_000 + DEFAULT_PAYMENT_TTL);
    t.client.reclaim_expired(&id);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [PaymentReclaimed {
            id,
            amount: 5_000,
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

#[test]
fn admin_handover_emits_adm_prop_and_adm_acc() {
    let t = setup();
    let new_admin = Address::generate(&t.env);
    t.client.propose_admin(&new_admin);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [AdminProposed {
            proposed: new_admin.clone(),
        }
        .to_xdr(&t.env, &t.client.address)]
    );
    t.client.accept_admin(&new_admin);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.client.address),
        [AdminAccepted {
            previous: t.admin.clone(),
            new_admin,
        }
        .to_xdr(&t.env, &t.client.address)]
    );
}

// ----- property tests: escrow balance invariants ---------------------------

struct SplitMix64(u64);

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }

    fn range(&mut self, bound: usize) -> usize {
        (self.next_u64() as usize) % bound
    }
}

#[test]
fn property_escrow_balance_and_single_transition_invariants() {
    const SEQUENCES: u64 = 500;
    const STEPS_PER_SEQ: usize = 6;
    const MAX_PAYMENTS: usize = (SEQUENCES as usize) * STEPS_PER_SEQ;
    const TTL: u64 = 100;
    const MINT_PER_VASP: i128 = 100_000_000;

    let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    let mut now: u64 = 1_000;
    env.ledger().set_timestamp(now);

    let admin = Address::generate(&env);
    let threshold_admin = Address::generate(&env);
    let vasps = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let beneficiaries = [Address::generate(&env), Address::generate(&env)];

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token_addr = sac.address();
    let sac_client = StellarAssetClient::new(&env, &token_addr);
    for v in &vasps {
        sac_client.mint(v, &MINT_PER_VASP);
    }
    let token = TokenClient::new(&env, &token_addr);
    let total_supply = MINT_PER_VASP * (vasps.len() as i128);

    let id = env.register(
        ComplyRail,
        (admin.clone(), threshold_admin.clone(), Some(TTL)),
    );
    let client = ComplyRailClient::new(&env, &id);

    let jurisdictions = ["US", "US", "GB", "GB"];
    for (i, v) in vasps.iter().enumerate() {
        client.register_vasp(
            v,
            &s(&env, "VASP"),
            &s(&env, jurisdictions[i]),
            &key(&env, (i + 1) as u8),
            &None,
        );
    }
    client.set_threshold(&token_addr, &s(&env, "US"), &3_000);
    client.set_threshold(&token_addr, &s(&env, "GB"), &1_000);
    client.set_asset_allowed(&token_addr, &true);

    // Track (status, amount, transitions) for every created payment id.
    let mut tracked: [Option<(PaymentStatus, i128, u8)>; MAX_PAYMENTS] = [None; MAX_PAYMENTS];
    let mut pending_sum: i128 = 0;
    let mut payment_count: u64 = 0;

    let mut total_submitted = 0u64;
    let mut total_attested = 0u64;
    let mut total_acked = 0u64;
    let mut total_released = 0u64;
    let mut total_rejected = 0u64;
    let mut total_reclaimed = 0u64;

    for seed in 1..=SEQUENCES {
        let mut rng = SplitMix64::new(seed);
        let seq_start = payment_count;

        for step in 0..STEPS_PER_SEQ {
            let seq_count = payment_count - seq_start;
            // Bias toward submitting early in each sequence so there are active payments.
            let action = if seq_count == 0 { 0 } else { rng.range(10) };

            let touched_pid: Option<u64> = match action {
                // submit_payment (30% of steps, or first step of each sequence)
                0 | 1 | 2 => {
                    let from_idx = rng.range(vasps.len());
                    let mut to_idx = rng.range(vasps.len());
                    if to_idx == from_idx && rng.range(4) != 0 {
                        to_idx = (to_idx + 1) % vasps.len();
                    }
                    let ben_idx = rng.range(beneficiaries.len());
                    let amount = match rng.range(5) {
                        0 => (rng.next_u64() % 999 + 1) as i128,
                        1 => (rng.next_u64() % 2_000 + 1_000) as i128,
                        2 | 3 => (rng.next_u64() % 7_000 + 3_000) as i128,
                        _ => 0, // invalid amount error path
                    };
                    match client.try_submit_payment(
                        &vasps[from_idx],
                        &vasps[to_idx],
                        &beneficiaries[ben_idx],
                        &token_addr,
                        &amount,
                        &None,
                    ) {
                        Ok(Ok(pid)) => {
                            total_submitted += 1;
                            payment_count += 1;
                            Some(pid)
                        }
                        _ => None,
                    }
                }
                // submit_attestation
                3 | 4 => {
                    let pid = seq_start + (rng.next_u64() % seq_count);
                    let hash = key(&env, ((seed + step as u64) & 0xff) as u8);
                    if client
                        .try_submit_attestation(&pid, &hash, &s(&env, "IVMS101.2023"))
                        .is_ok()
                    {
                        total_attested += 1;
                    }
                    Some(pid)
                }
                // acknowledge_attestation
                5 => {
                    let pid = seq_start + (rng.next_u64() % seq_count);
                    if client.try_acknowledge_attestation(&pid).is_ok() {
                        total_acked += 1;
                    }
                    Some(pid)
                }
                // release_payment (either beneficiary VASP or admin override)
                6 => {
                    let pid = seq_start + (rng.next_u64() % seq_count);
                    let p = client.get_payment(&pid);
                    let caller = if rng.range(2) == 0 {
                        p.to_vasp
                    } else {
                        admin.clone()
                    };
                    if client.try_release_payment(&pid, &caller).is_ok() {
                        total_released += 1;
                    }
                    Some(pid)
                }
                // reject_payment (either beneficiary VASP or admin)
                7 => {
                    let pid = seq_start + (rng.next_u64() % seq_count);
                    let p = client.get_payment(&pid);
                    let caller = if rng.range(2) == 0 {
                        p.to_vasp
                    } else {
                        admin.clone()
                    };
                    if client
                        .try_reject_payment(&pid, &caller, &s(&env, "compliance reject"), &None)
                        .is_ok()
                    {
                        total_rejected += 1;
                    }
                    Some(pid)
                }
                // reclaim_expired
                8 => {
                    let pid = seq_start + (rng.next_u64() % seq_count);
                    if client.try_reclaim_expired(&pid).is_ok() {
                        total_reclaimed += 1;
                    }
                    Some(pid)
                }
                // advance ledger time so some payments expire
                _ => {
                    let delta = (rng.next_u64() % 120) + 10;
                    now += delta;
                    env.ledger().set_timestamp(now);
                    None
                }
            };

            // Update tracked state & verify single-transition invariant for touched payment.
            if let Some(pid) = touched_pid {
                let p = client.get_payment(&pid);
                let idx = pid as usize;
                match &mut tracked[idx] {
                    None => {
                        if p.status == PaymentStatus::Pending {
                            pending_sum += p.amount;
                        }
                        tracked[idx] = Some((p.status, p.amount, 0));
                    }
                    Some((prev_status, amount, transitions)) => {
                        if *prev_status != p.status {
                            assert_eq!(
                                *prev_status,
                                PaymentStatus::Pending,
                                "seed={seed} step={step} pid={pid}: terminal state {prev_status:?} changed to {:?}",
                                p.status
                            );
                            *transitions += 1;
                            assert!(
                                *transitions <= 1,
                                "seed={seed} step={step} pid={pid}: payment changed state {} times",
                                *transitions
                            );
                            pending_sum -= *amount;
                            *prev_status = p.status;
                        }
                    }
                }
            }

            // Assert escrow balance invariant after every step.
            let contract_balance = token.balance(&client.address);
            assert_eq!(
                contract_balance, pending_sum,
                "seed={seed} step={step}: contract balance ({contract_balance}) != pending sum ({pending_sum})"
            );
        }
    }

    // Cross-check full ledger scan of all payments and total token conservation.
    let final_count = client.payment_count();
    assert_eq!(final_count, payment_count);
    let mut scanned_pending_sum: i128 = 0;
    for pid in 0..final_count {
        let p = client.get_payment(&pid);
        if p.status == PaymentStatus::Pending {
            scanned_pending_sum += p.amount;
        }
        let (tracked_status, _, transitions) = tracked[pid as usize].unwrap();
        assert_eq!(p.status, tracked_status);
        assert!(transitions <= 1);
    }
    let final_contract_balance = token.balance(&client.address);
    assert_eq!(final_contract_balance, scanned_pending_sum);

    let mut accounted = final_contract_balance;
    for v in &vasps {
        accounted += token.balance(v);
    }
    for b in &beneficiaries {
        accounted += token.balance(b);
    }
    assert_eq!(accounted, total_supply);

    // Ensure every operation was actually exercised across the 500 sequences.
    assert!(total_submitted > 0, "no payments submitted");
    assert!(total_attested > 0, "no attestations submitted");
    assert!(total_acked > 0, "no attestations acknowledged");
    assert!(total_released > 0, "no payments released");
    assert!(total_rejected > 0, "no payments rejected");
    assert!(total_reclaimed > 0, "no payments reclaimed");
}
