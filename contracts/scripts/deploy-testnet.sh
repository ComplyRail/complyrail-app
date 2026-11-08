#!/usr/bin/env bash
# Build and deploy the ComplyRail contract to Stellar testnet.
#
# Requires the Stellar CLI (v25.2+): https://developers.stellar.org/docs/tools/cli
# Usage:  bash contracts/scripts/deploy-testnet.sh <ADMIN_G_ADDRESS> [deployer-identity]
#
# The admin is set by the contract constructor at deploy time, so it does not
# need to sign. Use your wallet's public address (Freighter, xBull, ...).
set -euo pipefail

ADMIN="${1:?usage: deploy-testnet.sh <ADMIN_G_ADDRESS> [deployer-identity]}"
DEPLOYER="${2:-complyrail-deployer}"
NETWORK="testnet"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/complyrail/target/wasm32v1-none/release/complyrail.wasm"

echo "==> Building contract"
(cd "$ROOT/complyrail" && stellar contract build)

if ! stellar keys address "$DEPLOYER" >/dev/null 2>&1; then
  echo "==> Creating and funding deployer identity '$DEPLOYER'"
  stellar keys generate "$DEPLOYER" --network "$NETWORK" --fund
fi

echo "==> Deploying (admin: $ADMIN)"
CONTRACT_ID="$(stellar contract deploy --wasm "$WASM" --source "$DEPLOYER" --network "$NETWORK" \
  -- --admin "$ADMIN")"

cat <<OUT

Deployed ComplyRail to $NETWORK
  Contract ID: $CONTRACT_ID
  Admin:       $ADMIN
  Explorer:    https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID

Dashboard env (.env.local or Vercel):
  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID
  NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
  NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
OUT
