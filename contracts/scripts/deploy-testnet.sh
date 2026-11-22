#!/usr/bin/env bash
# Build and deploy the ComplyRail contract to Stellar testnet.
#
# Requires the Stellar CLI pinned to STELLAR_CLI_VERSION below (the same version
# the GitHub workflows use): https://developers.stellar.org/docs/tools/cli
# Usage:  bash contracts/scripts/deploy-testnet.sh <ADMIN_G_ADDRESS> <THRESHOLD_ADMIN_G_ADDRESS> [deployer-identity]
#
# The admin and threshold admin are set by the contract constructor at deploy
# time, so neither needs to sign. Use two different public addresses (Freighter,
# xBull, ...). The threshold admin must be a separate key from the admin, so one
# compromised key cannot change both the VASP registry and the Travel Rule
# thresholds.
set -euo pipefail

STELLAR_CLI_VERSION="30.0.1"

USAGE="usage: deploy-testnet.sh <ADMIN_G_ADDRESS> <THRESHOLD_ADMIN_G_ADDRESS> [deployer-identity]"
ADMIN="${1:?$USAGE}"
THRESHOLD_ADMIN="${2:?$USAGE}"
DEPLOYER="${3:-complyrail-deployer}"

if [ "$ADMIN" = "$THRESHOLD_ADMIN" ]; then
  echo "error: the threshold admin must be a different address from the admin" >&2
  exit 1
fi
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

echo "==> Deploying (admin: $ADMIN, threshold admin: $THRESHOLD_ADMIN)"
CONTRACT_ID="$(stellar contract deploy --wasm "$WASM" --source "$DEPLOYER" --network "$NETWORK" \
  -- --admin "$ADMIN" --threshold_admin "$THRESHOLD_ADMIN")"

cat <<OUT

Deployed ComplyRail to $NETWORK
  Contract ID:     $CONTRACT_ID
  Admin:           $ADMIN
  Threshold admin: $THRESHOLD_ADMIN
  Explorer:    https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID

Dashboard env (.env.local or Vercel):
  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID
  NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
  NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
OUT
