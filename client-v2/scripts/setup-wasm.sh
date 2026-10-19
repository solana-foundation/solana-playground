#!/usr/bin/env bash
# The wasm half of `yarn setup`: builds the real wasm/*/pkg packages, or stubs them under USE_WASM_STUBS=true, then installs them.
set -euo pipefail

client_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)
root_dir=$(dirname "$client_dir")
# shellcheck source=wasm-stubs.sh
. "$client_dir/scripts/wasm-stubs.sh"

# Every worktree shares one target folder, so only the first build pays the cold compile.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/solana-playground/wasm-target}"

# A first shared folder starts as a clone of the main checkout's own wasm/target, which keeps that folder intact.
seed_target_dir() {
  [ -e "$CARGO_TARGET_DIR" ] && return
  local main_dir source partial
  main_dir=$(dirname "$(git -C "$root_dir" rev-parse --path-format=absolute --git-common-dir)")
  source="$main_dir/wasm/target"
  [ -d "$source" ] || return 0
  partial="$CARGO_TARGET_DIR.partial"
  mkdir -p "$(dirname "$CARGO_TARGET_DIR")"
  rm -rf "$partial"
  echo ">>> seeding $CARGO_TARGET_DIR from $source"
  # An APFS clone takes no space until a file changes; elsewhere -c fails and a plain copy runs.
  if ! cp -c -R "$source" "$partial" 2>/dev/null; then
    rm -rf "$partial"
    cp -R "$source" "$partial"
  fi
  mv "$partial" "$CARGO_TARGET_DIR"
}

# wasm-pack writes into an existing pkg/, so a stub's index.js would outlive the real build beside it.
remove_stubs() {
  local package
  for package in $WASM_PACKAGES; do
    if holds_wasm_stub "$root_dir/wasm/$package/pkg"; then
      rm -rf "$root_dir/wasm/$package/pkg"
    fi
  done
}

if wasm_stubs_requested; then
  echo ">>> USE_WASM_STUBS=true: stubbing the wasm packages"
  bash "$root_dir/wasm/stub-packages.sh"
else
  seed_target_dir
  remove_stubs
  bash "$root_dir/wasm/build.sh"
fi

remove_installed_wasm_packages "$client_dir"
# --check-files makes yarn notice the folders just removed; without it the integrity file says nothing changed.
yarn --cwd "$client_dir" install --frozen-lockfile --check-files
