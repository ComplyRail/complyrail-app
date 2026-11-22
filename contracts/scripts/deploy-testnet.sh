#!/usr/bin/env bash
# Build and deploy the ComplyRail contract to Stellar testnet.
#
# Requires the Stellar CLI pinned to STELLAR_CLI_VERSION below (the same version
# the GitHub workflows use): https://developers.stellar.org/docs/tools/cli
# Usage:  bash contracts/scripts/deploy-testnet.sh <ADMIN_G_ADDRESS> [deployer-identity]
#
# The admin is set by the contract constructor at deploy time, so it does not
# need to sign. Use your wallet's public address (Freighter, xBull, ...).
set -euo pipefail

STELLAR_CLI_VERSION="30.0.1"

ADMIN="${1:?usage: deploy-testnet.sh <ADMIN_G_ADDRESS> [deployer-identity]}"
DEPLOYER="${2:-complyrail-deployer}"
NETWORK="testnet"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/complyrail/target/wasm32v1-none/release/complyrail.wasm"

if ! command -v stellar >/dev/null 2>&1; then
  echo "error: stellar CLI not found. Install version $STELLAR_CLI_VERSION." >&2
  exit 1
fi
# `stellar --version` prints e.g. "stellar 30.0.1 (...)"; compare the version number.
INSTALLED_VERSION="$(stellar --version | awk 'NR==1{print $2}')"
if [ "$INSTALLED_VERSION" != "$STELLAR_CLI_VERSION" ]; then
  echo "error: stellar CLI $INSTALLED_VERSION found, but $STELLAR_CLI_VERSION is required (matches CI)." >&2
  exit 1
fi

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
