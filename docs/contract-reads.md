# Reading the ComplyRail Contract from Rust

This document provides copy-paste Rust snippets for dApp developers who want to
query the ComplyRail Soroban contract from their own Rust code, an indexer, or a
CLI tool, without going through the TypeScript dashboard.

All reads are **simulation-only**: no transaction is submitted and no fee is
charged. The examples use `soroban-sdk` client bindings generated from the
contract spec and the `stellar-rpc-client` / `stellar-sdk` crates.

---

## Prerequisites

Add these dependencies to your `Cargo.toml`:

```toml
[dependencies]
soroban-sdk          = { version = "29" }
stellar-rpc-client   = { version = "0.1" }   # or use reqwest + raw JSON-RPC
stellar-strkey       = { version = "0.0.9" }
tokio                = { version = "1", features = ["full"] }
serde_json           = { version = "1" }
```

You will also need the generated contract bindings. The easiest way to get them
is with the Stellar CLI:

```bash
stellar contract bindings rust \
  --id  <CONTRACT_ID> \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --output-dir ./complyrail-bindings
```

Then reference the generated crate in your `Cargo.toml`:

```toml
[dependencies]
complyrail = { path = "./complyrail-bindings" }
```

The contract ID and network passphrase for the current testnet deployment are
recorded in `contracts/deployments/testnet.json`.

---

## Reading the admin address

```rust
use complyrail::Client;
use stellar_rpc_client::Client as RpcClient;

const RPC_URL: &str = "https://soroban-testnet.stellar.org";
const CONTRACT_ID: &str = "CA5T254NPONJHMOA6UWKRPKW2UI3IUOQ6TWUQGP2NFPLAZWOSCVYXS5Q";
const NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let rpc = RpcClient::new(RPC_URL)?;
    let contract = Client::new(CONTRACT_ID)?;

    // Simulate the read – no fee, no signature required.
    let admin: String = contract.admin().invoke(&rpc).await?;
    println!("Admin: {admin}");
    Ok(())
}
```

---

## Listing registered VASPs

The contract paginates VASPs in pages of up to 100 entries. This snippet collects
all pages into a single `Vec`:

```rust
use complyrail::{Client, VaspEntry};

async fn list_all_vasps(contract: &Client, rpc: &RpcClient) -> anyhow::Result<Vec<VaspEntry>> {
    let count: u32 = contract.vasp_count().invoke(rpc).await?;
    let page_size: u32 = 100;
    let mut vasps = Vec::with_capacity(count as usize);

    let mut start: u32 = 0;
    while start < count {
        let limit = page_size.min(count - start);
        let addresses: Vec<String> = contract
            .list_vasps()
            .start(start)
            .limit(limit)
            .invoke(rpc)
            .await?;

        for address in addresses {
            let entry: VaspEntry = contract.get_vasp().address(&address).invoke(rpc).await?;
            vasps.push(entry);
        }
        start += limit;
    }
    Ok(vasps)
}
```

---

## Reading a single payment

```rust
use complyrail::{Client, Payment};

async fn get_payment(
    contract: &Client,
    rpc: &RpcClient,
    payment_id: u64,
) -> anyhow::Result<Option<Payment>> {
    match contract.get_payment().payment_id(payment_id).invoke(rpc).await {
        Ok(payment) => Ok(Some(payment)),
        Err(e) if e.to_string().contains("Error(Contract, #7)") => {
            // Error code 7 = PaymentNotFound – treat as None rather than an error.
            Ok(None)
        }
        Err(e) => Err(e.into()),
    }
}
```

---

## Listing all thresholds

```rust
use complyrail::{Client, ThresholdRow};

async fn list_thresholds(contract: &Client, rpc: &RpcClient) -> anyhow::Result<Vec<ThresholdRow>> {
    // Returns every (asset, jurisdiction, amount) tuple with amount > 0.
    let rows: Vec<(String, String, i128)> = contract.list_thresholds().invoke(rpc).await?;
    Ok(rows
        .into_iter()
        .map(|(asset, jurisdiction, amount)| ThresholdRow {
            asset,
            jurisdiction,
            amount,
        })
        .collect())
}
```

---

## Reading the current threshold for a specific asset and jurisdiction

```rust
async fn get_threshold(
    contract: &Client,
    rpc: &RpcClient,
    asset: &str,
    jurisdiction: &str,
) -> anyhow::Result<i128> {
    // Returns 0 if no rule is set (the payment still needs an attestation when
    // the global `"*"` wildcard is also unset).
    let amount: i128 = contract
        .get_threshold()
        .asset(asset)
        .jurisdiction(jurisdiction)
        .invoke(rpc)
        .await?;
    Ok(amount)
}
```

---

## Paginating payments for a specific VASP

```rust
use complyrail::{Client, Payment};

/// Fetches all payments where `vasp` is the originator or beneficiary, oldest first.
async fn payments_for_vasp(
    contract: &Client,
    rpc: &RpcClient,
    vasp: &str,
) -> anyhow::Result<Vec<Payment>> {
    const PAGE: u32 = 100;
    let mut payments = Vec::new();
    let mut start: u64 = 0;

    loop {
        let page: Vec<Payment> = contract
            .list_payments_by_vasp()
            .vasp(vasp)
            .start(start)
            .limit(PAGE)
            .invoke(rpc)
            .await?;
        let done = (page.len() as u32) < PAGE;
        start += page.len() as u64;
        payments.extend(page);
        if done {
            break;
        }
    }
    Ok(payments)
}
```

---

## Error codes

Contract errors arrive as `Error(Contract, #<code>)` in the simulation response.
The full table is in `contracts/README.md`. The codes most commonly encountered
in read-only paths:

| Code | Variant | Meaning |
|------|---------|---------|
| 4 | `VaspNotFound` | No VASP registered at this address |
| 7 | `PaymentNotFound` | No payment with this id |
| 19 | `ThresholdNotFound` | No threshold set for this `(asset, jurisdiction)` |

---

## Notes

- All amounts use **stroops** (1 XLM = 10 000 000 stroops). Divide by 10^7 for
  display.
- Public keys on-chain are 32-byte X25519 keys used for off-chain IVMS101
  payload encryption (see `docs/ivms-encryption.md`). They are unrelated to the
  Stellar Ed25519 account keys.
- The `list_payments` function returns ids `[start, start + limit)` in ascending
  order. For newest-first, fetch the total with `payment_count` and read
  backwards.
