#!/usr/bin/env bash
# The wasm half of `yarn setup`: builds the real wasm/*/pkg packages, or stubs them under USE_WASM_STUBS=true, then installs them.
set -euo pipefail

client_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)
root_dir=$(dirname "$client_dir")
# shellcheck source=wasm-stubs.sh
. "$client_dir/scripts/wasm-stubs.sh"

# Each checkout builds into its own target folders: cargo names a path cdylib without a hash and judges freshness by
# mtime, so a folder shared between worktrees packaged one worktree's .wasm into another's pkg.
# wasm/Cargo.toml excludes rust-analyzer, so it builds as its own workspace into its own target folder.
TARGET_DIRS="wasm/target wasm/rust-analyzer/target"

# $1: the main checkout's target folder, $2: this checkout's; sets the caller's `seeded`. An APFS clone takes no space until a file changes.
seed_target_dir() {
  local source="$1" target="$2" partial="$2.partial"
  [ -e "$target" ] && return
  if [ ! -d "$source" ]; then
    echo ">>> nothing to seed $target from: $source does not exist"
    return
  fi
  rm -rf "$partial"
  echo ">>> seeding $target from $source"
  if [ "$(uname)" = Darwin ]; then
    cp -c -R "$source" "$partial"
  else
    cp -R "$source" "$partial"
  fi
  mv "$partial" "$target"
  seeded=true
}

# A linked worktree's first build starts from the main checkout's target folders, so it skips the cold compile.
seed_target_dirs() {
  if [ -n "${CARGO_TARGET_DIR:-}" ]; then
    echo ">>> CARGO_TARGET_DIR is set: cargo builds into $CARGO_TARGET_DIR, nothing seeded"
    return
  fi
  local git_dir common_dir main_dir dir seeded=false
  git_dir=$(git -C "$root_dir" rev-parse --path-format=absolute --git-dir)
  common_dir=$(git -C "$root_dir" rev-parse --path-format=absolute --git-common-dir)
  [ "$git_dir" = "$common_dir" ] && return
  main_dir=$(dirname "$common_dir")
  for dir in $TARGET_DIRS; do
    seed_target_dir "$main_dir/$dir" "$root_dir/$dir"
  done
  if [ "$seeded" = true ]; then
    # The copies are newer than this checkout's sources by mtime; touching the sources rebuilds its own crates once.
    git -C "$root_dir" ls-files -z wasm | (cd "$root_dir" && xargs -0 touch)
  fi
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
  seed_target_dirs
  remove_stubs
  bash "$root_dir/wasm/build.sh"
fi

# Installing over an old tree keeps stale wasm copies (yarn 1 re-copies a file: package only when its folder is missing)
# and stale hoisting (a webpack build failed on @noble/hashes/sha3); .cache holds build caches, not packages.
if [ -d "$client_dir/node_modules" ]; then
  echo ">>> clearing node_modules, all but .cache"
  find "$client_dir/node_modules" -mindepth 1 -maxdepth 1 ! -name .cache -exec rm -rf {} +
fi
yarn --cwd "$client_dir" install --frozen-lockfile
