#!/usr/bin/env bash
# Writes anchor-legacy-idl.so, Anchor v1.1.2's own `#[program(legacy_idl)]` test program, which the integration tests run in LiteSVM.
# Usage: bash regenerate-legacy-idl.sh   (CARGO_BUILD_SBF=<path> for an Agave 3.x cargo-build-sbf outside PATH)
# anchor-lang 1.1.2 needs a Rust that knows edition 2024, which platform tools v1.52 carry and the default ones of Agave 3.0 do not.
set -euo pipefail

CARGO_BUILD_SBF="${CARGO_BUILD_SBF:-cargo-build-sbf}"
TOOLS_VERSION=v1.52
ANCHOR_TAG=v1.1.2

FIXTURES="$(cd "$(dirname "$0")" && pwd)"
# Under the checkout's gitignored `wasm/target`, never a system temp folder
WORK="$FIXTURES/../../../../../wasm/target/sources"
ANCHOR="$WORK/anchor-$ANCHOR_TAG"
OUT="$WORK/legacy-idl-out"

if [ ! -d "$ANCHOR" ]; then
  git clone --depth 1 --branch "$ANCHOR_TAG" https://github.com/solana-foundation/anchor.git "$ANCHOR"
fi

"$CARGO_BUILD_SBF" --tools-version "$TOOLS_VERSION" \
  --manifest-path "$ANCHOR/tests/anchor-cli-legacy-idl/programs/anchor-cli-legacy-idl/Cargo.toml" \
  --sbf-out-dir "$OUT"

cp "$OUT/anchor_cli_legacy_idl.so" "$FIXTURES/anchor-legacy-idl.so"
