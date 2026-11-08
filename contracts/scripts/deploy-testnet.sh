#!/usr/bin/env bash
# Build, deploy and initialise the ComplyRail contract on Stellar testnet.
#
# Requires the Stellar CLI: https://developers.stellar.org/docs/tools/cli
# Usage:  bash contracts/scripts/deploy-testnet.sh [identity-name]
set -euo pipefail

IDENTITY="${1:-complyrail-admin}"
NETWORK="testnet"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/complyrail/target/wasm32v1-none/release/complyrail.wasm"

echo "==> Building contract"
(cd "$ROOT/complyrail" && stellar contract build)

if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  echo "==> Creating and funding identity '$IDENTITY'"
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
fi
ADMIN="$(stellar keys address "$IDENTITY")"

echo "==> Deploying"
CONTRACT_ID="$(stellar contract deploy --wasm "$WASM" --source "$IDENTITY" --network "$NETWORK")"

echo "==> Initialising (admin: $ADMIN)"
stellar contract invoke --id "$CONTRACT_ID" --source "$IDENTITY" --network "$NETWORK" \
  -- initialize --admin "$ADMIN"

cat <<EOF

Deployed ComplyRail to $NETWORK
  Contract ID: $CONTRACT_ID
  Admin:       $ADMIN

Add to the dashboard's .env.local:
  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID
  NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org:443
  NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
EOF
