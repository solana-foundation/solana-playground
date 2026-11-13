#!/usr/bin/env bash
# Writes every output of this folder (`*.convert*.json`, `*.type.txt`) from the
# Anchor 1.1.2 binary, and checks that the binary rejects what the tests expect it to reject.
# Usage: bash regenerate.sh   (ANCHOR=<path> for a binary outside avm)
set -euo pipefail

ANCHOR="${ANCHOR:-$HOME/.avm/bin/anchor-1.1.2}"
PROGRAM_ID=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

cd "$(dirname "$0")"

if [ "$("$ANCHOR" --version)" != "anchor-cli 1.1.2" ]; then
  echo "$ANCHOR is not Anchor 1.1.2" >&2
  exit 1
fi

"$ANCHOR" idl convert legacy.json > legacy.convert.json
"$ANCHOR" idl convert legacy.json --program-id "$PROGRAM_ID" > legacy.convert-program-id.json
"$ANCHOR" idl convert legacy-no-address.json --program-id "$PROGRAM_ID" > legacy-no-address.convert-program-id.json
"$ANCHOR" idl convert current.json --to-legacy > current.convert-to-legacy.json
"$ANCHOR" idl convert current-full.json --program-id "$PROGRAM_ID" > current-full.convert-program-id.json
"$ANCHOR" idl type current-full.json > current-full.type.txt

# Fails unless `anchor <arguments after the status>` exits with that status
exits_with() {
  local expected="$1" status=0
  shift
  "$ANCHOR" "$@" > /dev/null 2>&1 || status=$?
  if [ "$status" -ne "$expected" ]; then
    echo "expected exit status $expected, got $status: anchor $*" >&2
    exit 1
  fi
}

exits_with 1 idl convert legacy-no-address.json
exits_with 2 idl convert legacy.json --program-id not-an-address

for name in $(jq -r '.convert | keys[]' rejected.json); do
  exits_with 1 idl convert <(jq --arg name "$name" '.convert[$name]' rejected.json)
done
for name in $(jq -r '.convertToLegacy | keys[]' rejected.json); do
  # The same input converts without `--to-legacy`, so the legacy format is what refuses it
  exits_with 0 idl convert <(jq --arg name "$name" '.convertToLegacy[$name]' rejected.json)
  exits_with 1 idl convert --to-legacy <(jq --arg name "$name" '.convertToLegacy[$name]' rejected.json)
done
