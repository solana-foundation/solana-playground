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

REACT_APP_VERCEL_ENV="${VERCEL_ENV-}" \
  REACT_APP_VERCEL_GIT_COMMIT_SHA="${VERCEL_GIT_COMMIT_SHA-}" \
  NODE_OPTIONS='--max-old-space-size=6144' \
  yarn build:bundle

node scripts/wasm-stubs.mjs check-build build
