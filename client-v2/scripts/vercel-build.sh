#!/usr/bin/env bash
set -euo pipefail

# Vercel build hook for the client: vercel.json's buildCommand. A script of its
# own because Vercel rejects a buildCommand longer than 256 characters.
#
# The environment checks run first, so a misconfigured deployment fails before
# the bundle build; the stub check runs last, on what the build emitted.

cd "$(dirname -- "${BASH_SOURCE[0]}")/.."

node scripts/check-agent-env.mjs
node scripts/check-unstable-env.mjs

# Vercel adds system variables under the framework's prefix on its own, such as
# REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG, which no project setting holds.
# The client reads none of them, CRA would inline them all, and the public env
# check fails the build on each; drop them, then set the two the client reads.
for name in $(compgen -e); do
  if [[ "$name" =~ ^[Rr][Ee][Aa][Cc][Tt]_[Aa][Pp][Pp]_[Vv][Ee][Rr][Cc][Ee][Ll]_ ]]; then
    unset "$name"
  fi
done

REACT_APP_VERCEL_ENV="${VERCEL_ENV-}" \
  REACT_APP_VERCEL_GIT_COMMIT_SHA="${VERCEL_GIT_COMMIT_SHA-}" \
  NODE_OPTIONS='--max-old-space-size=6144' \
  yarn build:bundle

node scripts/wasm-stubs.mjs check-build build
