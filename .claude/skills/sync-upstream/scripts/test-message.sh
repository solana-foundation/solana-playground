#!/usr/bin/env bash
# Regression test: the generated body for the first synced range must equal the merged commit a7a8a1f9.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
script="$here/sync-upstream.sh"
failed=0

check() {
  if [[ $2 == "$3" ]]; then
    echo "PASS: $1"
  else
    echo "FAIL: $1" >&2
    diff <(printf '%s\n' "$2") <(printf '%s\n' "$3") >&2 || true
    failed=1
  fi
}

actual=$(bash "$script" message 86460da5 6ec9b806)
expected_body=$(git -C "$repo" log -1 --format=%B a7a8a1f9ed2e9a2cebafd4b59427fe61ab99702a | tail -n +2)
check "subject" 'chore(upstream): merge solpg/master to 6ec9b806 (86460da5..6ec9b806)' "$(head -n1 <<< "$actual")"
check "body matches a7a8a1f9" "$expected_body" "$(tail -n +2 <<< "$actual")"

check "synced-to reads a squash subject" 1bfdfabc "$(bash "$script" synced-to 'chore(upstream): sync to 1bfdfabc (6ec9b806..1bfdfabc)')"
check "synced-to reads a merge subject" 1693239d "$(bash "$script" synced-to 'chore(upstream): merge solpg/master to 1693239d (1bfdfabc..1693239d)')"

exit "$failed"
