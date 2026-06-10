#!/usr/bin/env bash
set -euo pipefail

# Vercel install hook for the client.
#
# Order matters: client/package.json has file-deps like "../wasm/anchor-cli/pkg"
# which don't exist until wasm-pack runs, so we must compile wasm BEFORE yarn install.

export CARGO_HOME="$PWD/node_modules/.cache/cargo"
export RUSTUP_HOME="$PWD/node_modules/.cache/rustup"
export CARGO_TARGET_DIR="$PWD/node_modules/.cache/cargo-target"
mkdir -p "$CARGO_HOME" "$RUSTUP_HOME" "$CARGO_TARGET_DIR"
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  # Pin matches wasm/rust-toolchain.toml so the initial `cargo install wasm-pack`
  # inside wasm/build.sh has a working toolchain before the per-package loop
  # installs anything additional.
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain 1.75.0 --profile minimal --target wasm32-unknown-unknown
fi
rustup default 1.75.0

# build.sh installs wasm-pack via cargo and the pinned toolchain via rustup.
# Omit --update — its post-build `yarn install && yarn upgrade` would recurse.
bash ../wasm/build.sh

yarn install --frozen-lockfile
