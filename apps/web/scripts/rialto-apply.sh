#!/bin/bash
# Rialto Swap API integrator application for Compose.
# Reads DEPLOYER_PRIVATE_KEY from the repo .env (the wallet becomes the integrator
# owner and fee recipient), signs Rialto's nonce messages, and submits the application.
# The key is exported only into the node process and never printed.
#
#   bash apps/web/scripts/rialto-apply.sh            # submit application (+ key if auto-approved)
#   bash apps/web/scripts/rialto-apply.sh --status   # check application / masked keys
#   INTEGRATOR_ID=<id> bash apps/web/scripts/rialto-apply.sh --key   # mint the key after approval
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || ENV_FILE="/Users/apple/Plane 2/.env"

OWNER_PRIVATE_KEY=$(grep -E "^DEPLOYER_PRIVATE_KEY=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ -n "$OWNER_PRIVATE_KEY" ] || { echo "DEPLOYER_PRIVATE_KEY not set in $ENV_FILE"; exit 1; }
export OWNER_PRIVATE_KEY

export DISPLAY_NAME="${DISPLAY_NAME:-Compose}"
export SLUG="${SLUG:-novex}"
export CONTACT_EMAIL="${CONTACT_EMAIL:-saurabh.sharma9827@gmail.com}"
export TELEGRAM_HANDLE="${TELEGRAM_HANDLE:-Sol_sohan}"
export APP_URL="${APP_URL:-https://github.com/novex11/contract-v2}"
export MAX_FEE_BPS="${MAX_FEE_BPS:-50}"
# Free-text reason shown to the Rialto team (APPLICATION_DESCRIPTION overrides the default in the .mjs).
# Raw key is shown once by Rialto; it is written here with 0600 perms.
export RIALTO_OUT_FILE="${RIALTO_OUT_FILE:-$ROOT/.rialto-key.json}"

cd "$HERE/.."
node scripts/rialto-apply.mjs "$@"
