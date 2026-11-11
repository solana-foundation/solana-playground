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

# Vercel adds REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG to the build on its
# own; no project setting holds it. It configures @vercel/analytics and
# @vercel/speed-insights, which the client does not install, so nothing reads
# it, and the public env check fails the build on it. Should the client adopt
# either package, read it in client-env.ts and give it a VALUE_SHAPES entry
# instead. Only this name: any other variable Vercel adds fails the check by
# name, to be decided on its own.
unset REACT_APP_VERCEL_OBSERVABILITY_CLIENT_CONFIG

REACT_APP_VERCEL_ENV="${VERCEL_ENV-}" \
  REACT_APP_VERCEL_GIT_COMMIT_SHA="${VERCEL_GIT_COMMIT_SHA-}" \
  NODE_OPTIONS='--max-old-space-size=6144' \
  yarn build:bundle

node scripts/wasm-stubs.mjs check-build build
