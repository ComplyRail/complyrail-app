#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    symbol_short,
    testutils::{Address as _, Events as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String, Val,
};
use soroban_sdk::Event;

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

// ----- cancel --------------------------------------------------------------

#[test]
fn cancel_before_attestation_refunds_originator() {
    let t = setup();
    let id = t.client.submit_payment(
        &t.vasp_a,
        &t.vasp_b,
        &t.beneficiary,
        &t.token.address,
        &5_000,
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
        &5_000,
    );
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));

    let r = t.client.try_cancel_payment(&id);
    assert_eq!(r, Err(Ok(Error::AlreadyAttested)));

    // funds stay in escrow and the payment can still be released
    assert_eq!(t.client.get_payment(&id).status, PaymentStatus::Pending);
    assert_eq!(t.token.balance(&t.client.address), 5_000);
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
        &2_999,
    );
    let r = t.client.try_cancel_payment(&id);
    assert_eq!(r, Err(Ok(Error::PaymentNotPending)));
    assert_eq!(t.token.balance(&t.beneficiary), 2_999);
}

// ----- transfer failures ---------------------------------------------------

/// Test-only token whose transfers panic when the recipient is the blocked
/// address. This stands in for a recipient with no trustline on the asset.
#[contract]
struct BlockingToken;

#[contractimpl]
impl BlockingToken {
    pub fn block(env: Env, who: Address) {
        env.storage().instance().set(&symbol_short!("blocked"), &who);
    }

    pub fn transfer(env: Env, from: Address, to: Address, _amount: i128) {
        from.require_auth();
        if let Some(blocked) = env
            .storage()
            .instance()
            .get::<_, Address>(&symbol_short!("blocked"))
        {
            if blocked == to {
                panic!("recipient has no trustline");
            }
        }
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

    let id = env.register(ComplyRail, (admin, None::<u64>));
    let client = ComplyRailClient::new(env, &id);
    client.register_vasp(&vasp_a, &s(env, "Acme Exchange"), &s(env, "US"), &key(env, 1), &None);
    client.register_vasp(&vasp_b, &s(env, "Beta Finance"), &s(env, "GB"), &key(env, 2), &None);
    client.set_threshold(&token, &s(env, "US"), &3_000);
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
        &2_000_000,
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
    let r = client.try_submit_payment(&vasp_a, &vasp_b, &beneficiary, &token, &2_999);
    assert_eq!(r, Err(Ok(Error::TransferFailed)));
    assert_eq!(client.payment_count(), 0);
}

#[test]
fn release_to_recipient_without_trustline_keeps_payment_pending() {
    let env = Env::default();
    let beneficiary = Address::generate(&env);
    let (client, vasp_a, vasp_b, token) = blocking_setup(&env, &beneficiary);

    // Above threshold: escrow succeeds, the payout at release does not.
    let id = client.submit_payment(&vasp_a, &vasp_b, &beneficiary, &token, &5_000);
    client.submit_attestation(&id, &key(&env, 7), &s(&env, "IVMS101.2023"));

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
        &2_999,
    );
    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(&t, &submitted(&t, id, 2_999, false)));
    expected.push_back(ev(
        &t,
        &PaymentReleased {
            id,
            asset: t.token.address.clone(),
            amount: 2_999,
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
        &5_000,
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
        &5_000,
    );
    t.client
        .submit_attestation(&id, &key(&t.env, 7), &s(&t.env, "IVMS101.2023"));
    t.client.release_payment(&id, &t.vasp_b);

    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(
        &t,
        &PaymentReleased {
            id,
            asset: t.token.address.clone(),
            amount: 5_000,
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
        &5_000,
    );
    t.client.reject_payment(&id, &t.vasp_b, &s(&t.env, "bad data"));

    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(
        &t,
        &PaymentRejected {
            id,
            asset: t.token.address.clone(),
            reason: s(&t.env, "bad data"),
        },
    ));
    assert_eq!(events_of(&t), expected);
}

#[test]
fn reclaim_event_carries_asset() {
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

    let mut expected = Vec::new(&t.env);
    expected.push_back(ev(
        &t,
        &PaymentRejected {
            id,
            asset: t.token.address.clone(),
            reason: s(&t.env, "expired"),
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
        &5_000,
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
