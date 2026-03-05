#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Load env vars
source .env

# Deploy and verify in one command
forge script script/DeploySentAILogger.s.sol:DeploySentAILogger \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast \
  --verify

echo ""
echo "Done. Update loggerAddress in cre-workflow/config.staging.json with the new address above."
