#!/usr/bin/env bash
set -euo pipefail

# Renders the bundle change report as CI's build job does; ported from the Solana Explorer's scripts/build-info-report.sh.
#
# Usage, from client-v2 after `yarn build-fast`:
#   scripts/bundle-info-report.sh [base-ref] [head-sha]
#
# Output: build/bundle-report.md, also printed to stdout.

base_ref="${1:-master}"
# CI passes the pull request's head: its checkout is the merge commit, which no reviewer sees
head_sha="${2:-$(git rev-parse HEAD)}"
snapshot="$(node --input-type=module -e 'import { SNAPSHOT_PATH } from "./scripts/lib/bundle/snapshot.mjs"; console.log(SNAPSHOT_PATH);')"

git fetch origin "$base_ref"
# A base branch from before the snapshot existed has none; the report says so instead of failing the job.
# ls-tree prints nothing for a missing path and fails on any other error, which `set -e` then reports.
rm -f build/BUNDLE.base.md
listed="$(git ls-tree --full-tree --name-only FETCH_HEAD -- "$snapshot")"
if [ -n "$listed" ]; then
  git show "FETCH_HEAD:$snapshot" > build/BUNDLE.base.md
fi

# REPORT_FILE in scripts/lib/bundle/locate-pr.mjs; the build workflow uploads it from here
report="build/bundle-report.md"
# Written aside and moved, so a failed run leaves no empty report for CI to upload
rm -f "$report"
node scripts/bundle-info-diff.mjs build/BUNDLE.base.md "$base_ref" "$head_sha" > "$report.tmp"
mv "$report.tmp" "$report"
cat "$report"
