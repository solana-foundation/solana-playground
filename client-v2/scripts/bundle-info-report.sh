#!/usr/bin/env bash
set -euo pipefail

# Renders the bundle change report as CI's build job does; ported from the Solana Explorer's scripts/build-info-report.sh.
#
# Usage, from client-v2 after `yarn build-fast`:
#   scripts/bundle-info-report.sh [base-ref]
#
# Output: build/bundle-report.md, also printed to stdout.

base_ref="${1:-master}"
snapshot="client-v2/bench/BUNDLE.md"

node scripts/bundle-info.mjs build/BUNDLE.fresh.md

git fetch origin "$base_ref"
# A base branch from before the snapshot existed has none; the report says so instead of failing the job
rm -f build/BUNDLE.base.md
if git cat-file -e "FETCH_HEAD:$snapshot" 2>/dev/null; then
  git show "FETCH_HEAD:$snapshot" > build/BUNDLE.base.md
fi

node scripts/bundle-info-diff.mjs report build/BUNDLE.base.md build/BUNDLE.fresh.md "$base_ref" bench/BUNDLE.md > build/bundle-report.md
cat build/bundle-report.md
