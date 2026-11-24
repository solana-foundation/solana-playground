#!/usr/bin/env bash
# Writes program-metadata.so, the Program Metadata program the integration tests run in LiteSVM, from Devnet.
# Usage: bash regenerate.sh   (SOLANA=<path> for a CLI outside PATH, CLUSTER=<url> for another cluster)
set -euo pipefail

SOLANA="${SOLANA:-solana}"
CLUSTER="${CLUSTER:-https://api.devnet.solana.com}"
PROGRAM_ID=ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S

cd "$(dirname "$0")"

"$SOLANA" program dump --url "$CLUSTER" "$PROGRAM_ID" program-metadata.so
