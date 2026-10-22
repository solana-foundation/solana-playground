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
WORKSPACES="wasm wasm/rust-analyzer"

# The environment and cargo config can each point every worktree at one target folder again.
check_own_target_dirs() {
  local var workspace target expected
  for var in CARGO_TARGET_DIR CARGO_BUILD_TARGET_DIR; do
    if [ -n "${!var:-}" ]; then
      echo ">>> unsetting $var=${!var}: a target folder shared between worktrees packages one worktree's .wasm into another's pkg"
      unset "$var"
    fi
  done
  for workspace in $WORKSPACES; do
    # cargo reads its config and rust-toolchain.toml from the working directory, as wasm/build.sh runs it.
    if ! target=$(cd "$root_dir/$workspace" && cargo metadata --format-version 1 --no-deps --offline |
      node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).target_directory'); then
      echo ">>> warning: cargo metadata failed in $workspace, so its target folder is unchecked"
      continue
    fi
    # cargo reports the physical path, so a symlink in the checkout's path must not read as a mismatch.
    expected="$(cd "$root_dir/$workspace" && pwd -P)/target"
    if [ "$target" != "$expected" ]; then
      echo "cargo builds $workspace into $target, not $expected." >&2
      echo "Remove build.target-dir from the cargo config that sets it: a .cargo/config.toml above $workspace, or \$CARGO_HOME/config.toml." >&2
      exit 1
    fi
  done
}

# A linked worktree's first build starts from the main checkout's target folders, so it skips the cold compile.
# Each copy lands as <target>.partial and moves into place only after the touch, so an interrupted run leaves a .partial that the next run removes.
seed_target_dirs() {
  local git_dir common_dir main_dir workspace dir seeded=""
  git_dir=$(git -C "$root_dir" rev-parse --path-format=absolute --git-dir)
  common_dir=$(git -C "$root_dir" rev-parse --path-format=absolute --git-common-dir)
  [ "$git_dir" = "$common_dir" ] && return
  main_dir=$(dirname "$common_dir")
  for workspace in $WORKSPACES; do
    dir="$workspace/target"
    rm -rf "$root_dir/$dir.partial"
    if [ -e "$root_dir/$dir" ]; then
      echo ">>> $dir exists, not seeded"
      continue
    fi
    if [ ! -d "$main_dir/$dir" ]; then
      echo ">>> nothing to seed $dir from: $main_dir/$dir does not exist"
      continue
    fi
    echo ">>> seeding $dir from $main_dir/$dir"
    # An APFS clone takes no space until a file changes.
    if [ "$(uname)" = Darwin ]; then
      cp -c -R "$main_dir/$dir" "$root_dir/$dir.partial"
    else
      cp -R "$main_dir/$dir" "$root_dir/$dir.partial"
    fi
    seeded="$seeded $dir"
  done
  [ -n "$seeded" ] || return 0
  # Copied outputs can be newer than this checkout's sources; the touch makes the sources newer than any copied output.
  git -C "$root_dir" ls-files -z -co --exclude-standard --exclude='*.partial' wasm | (cd "$root_dir" && xargs -0 touch -c)
  for dir in $seeded; do
    mv "$root_dir/$dir.partial" "$root_dir/$dir"
  done
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
  check_own_target_dirs
  seed_target_dirs
  remove_stubs
  bash "$root_dir/wasm/build.sh"
fi

# Installing over an old tree keeps stale wasm copies (yarn 1 re-copies a file: package only when its folder is missing)
# and stale hoisting (a webpack build failed on @noble/hashes/sha3).
# .cache keeps the content-keyed caches; webpack's default-<mode> goes too, since it keys a package on name@version and a rebuilt wasm package keeps its version.
if [ -d "$client_dir/node_modules" ]; then
  echo ">>> clearing node_modules, all but .cache, and webpack's cache in .cache"
  find "$client_dir/node_modules" -mindepth 1 -maxdepth 1 ! -name .cache -exec rm -rf {} +
  rm -rf "$client_dir/node_modules/.cache/default-development" "$client_dir/node_modules/.cache/default-production"
fi
yarn --cwd "$client_dir" install --frozen-lockfile
