#!/usr/bin/env bash
set -euo pipefail

# Vercel install hook for the client.
#
# Order matters: client/package.json has file-deps like "../wasm/anchor-cli/pkg"
# which don't exist until wasm-pack runs, so we must compile wasm BEFORE yarn install.

# Rust state exceeds the Build Cache size limit, so it lives outside node_modules and only built output is cached.
RUST_ROOT="$PWD/.cache/rust"
export CARGO_HOME="$RUST_ROOT/cargo"
export RUSTUP_HOME="$RUST_ROOT/rustup"
export CARGO_TARGET_DIR="$RUST_ROOT/target"
export PATH="$CARGO_HOME/bin:$PATH"
# Matches wasm/build.sh's parsing of the same file.
RUST_VERSION=$(awk '/channel/{gsub(/"/, ""); print $3 }' ../wasm/rust-toolchain.toml)

WASM_CACHE="$PWD/node_modules/.cache/wasm-pkg"
INSTALL_MARK="node_modules/.cache/install-key"

# all_packages in wasm/build.sh, which does not export it; the loop in build_wasm_packages builds one package per PATH.
WASM_PACKAGES=(anchor-cli rust-analyzer seahorse-compile solana-cli spl-token-cli sugar-cli)
# One wasm-bindgen per version the packages resolve, kept with the rest of the Rust state.
WASM_BINDGEN_ROOT="$RUST_ROOT/wasm-bindgen"

DEFAULT_CRATES_CACHE="$PWD/node_modules/.cache/default-crates"
CRATES_DIR="$PWD/public/crates"
# What generate-default-crates writes; clearSupportedCrates in generate-crates.mjs keeps the same list.
DEFAULT_CRATE_FILES=(core.rs core.rs.br alloc.rs alloc.rs.br std.rs std.rs.br .default-crates-key)

# Vercel Remote Cache, shared by every build of the team (see docs/deploy-client-vercel.md,
# "Build cache"). Outside a Vercel build the token is unset and only the local tar is used.
REMOTE_TOKEN="${VERCEL_ARTIFACTS_TOKEN:-}"

# An array, not only a function: xargs runs programs and cannot call a shell function.
if command -v sha256sum >/dev/null 2>&1; then SHA256=(sha256sum); else SHA256=(shasum -a 256); fi

sha256() {
  "${SHA256[@]}" "$@"
}

# Hash of every file under wasm/; build output is excluded so a build does not change its own key.
wasm_source_key() {
  find ../wasm -type f \
    -not -path '*/target/*' -not -path '*/pkg/*' -not -path '*/node_modules/*' \
    -not -name '.DS_Store' -print0 \
    | LC_ALL=C sort -z | xargs -0 "${SHA256[@]}" | sha256 | cut -d' ' -f1
}

# Names only, never values: says which credentials this build received.
report_remote_credentials() {
  local name
  for name in VERCEL_ARTIFACTS_TOKEN VERCEL_ARTIFACTS_OWNER; do
    if [ -n "${!name:-}" ]; then echo ">>> Remote Cache: $name set"; else echo ">>> Remote Cache: $name unset"; fi
  done
}

remote_enabled() {
  [ -n "$REMOTE_TOKEN" ]
}

# $1: artifact key.
remote_url() {
  printf '%s' "https://api.vercel.com/v8/artifacts/$1${VERCEL_ARTIFACTS_OWNER:+?teamId=$VERCEL_ARTIFACTS_OWNER}"
}

remote_curl() {
  curl -fsS -H "Authorization: Bearer $REMOTE_TOKEN" "$@"
}

# Prints the HTTP status, 000 when no response arrived.
remote_status() {
  curl -sS -H "Authorization: Bearer $REMOTE_TOKEN" -w '%{http_code}' "$@" || true
}

# $1: artifact key, $2: HTTP status. A 404 is a miss; any other failure is logged, so an expired token is not read as one.
remote_found() {
  case "$2" in
    2??) return 0 ;;
    404) return 1 ;;
    *)
      echo ">>> Remote Cache: HTTP $2 for $1, treated as a miss" >&2
      return 1
      ;;
  esac
}

# $1: artifact key. Succeeds only when Remote Cache holds it.
remote_has() {
  remote_enabled || return 1
  local status
  status=$(remote_status -I -o /dev/null "$(remote_url "$1")")
  remote_found "$1" "$status"
}

# $1: artifact key, $2: destination. A failed download leaves no partial file to be read as a hit.
remote_fetch() {
  remote_enabled || return 1
  mkdir -p "$(dirname "$2")"
  local status
  status=$(remote_status -o "$2.part" "$(remote_url "$1")")
  remote_found "$1" "$status" && mv "$2.part" "$2"
}

# $1: archive, $2: what it holds, for the log. A corrupt copy is deleted, so the build regenerates and re-uploads it.
readable_archive() {
  tar -tf "$1" >/dev/null 2>&1 && return 0
  echo ">>> $2: cached archive $(basename "$1") is unreadable, discarding" >&2
  rm -f "$1"
  return 1
}

# $1: artifact key, $2: file, $3: what the file holds, for the log. Never fails the build.
remote_upload() {
  remote_enabled || return 0
  remote_curl -X PUT -H 'Content-Type: application/octet-stream' \
    --data-binary @"$2" -o /dev/null "$(remote_url "$1")" \
    || echo ">>> $3: Remote Cache upload failed; a build without the Build Cache copy rebuilds" >&2
}

# $1: package. Prints the lockfile wasm-pack reads for it: the one at the package's workspace root.
wasm_lockfile() {
  local manifest
  # Locating a manifest needs no particular toolchain, and the package's own may not be installed yet.
  # set -e does not reach into a command substitution, so the failure is returned by hand.
  manifest=$(cd "../wasm/$1" && cargo "+$RUST_VERSION" locate-project --workspace --message-format plain) || return 1
  [ -n "$manifest" ] || return 1
  printf '%s/Cargo.lock' "$(dirname "$manifest")"
}

# $1: package. Prints the wasm-bindgen version its lockfile resolves, the one wasm-pack will demand.
wasm_bindgen_version() {
  local lockfile version
  lockfile=$(wasm_lockfile "$1") || { echo ">>> wasm-bindgen: cannot locate the workspace of $1" >&2; return 1; }
  # Checked before the build: wasm-pack's own `cargo metadata` would rewrite a lockfile that does not match its manifest; --locked refuses it instead.
  cargo "+$RUST_VERSION" metadata --locked --format-version 1 --manifest-path "$(dirname "$lockfile")/Cargo.toml" >/dev/null \
    || { echo ">>> wasm-bindgen: $lockfile does not match its manifest; run cargo update -p wasm-bindgen there" >&2; return 1; }
  version=$(awk '$0 == "name = \"wasm-bindgen\"" { found = 1; next } found && /^version = / { gsub(/"/, "", $3); print $3; exit }' "$lockfile")
  if [ -z "$version" ]; then
    echo ">>> wasm-bindgen: no wasm-bindgen package in $lockfile for $1" >&2
    return 1
  fi
  printf '%s' "$version"
}

# $1: directory, $2: version. wasm-pack compares the second word of `--version`, so this does too.
wasm_bindgen_reports() {
  [ "$("$1/wasm-bindgen" --version 2>/dev/null | awk '{ print $2 }')" = "$2" ]
}

# $1: version, $2: destination. wasm-pack's own target choice: x86_64 Linux takes the musl build; any macOS takes the x86_64 build, which arm64 runs under Rosetta when it is installed.
download_wasm_bindgen() {
  local target url
  case "$(uname -sm)" in
    "Linux x86_64") target=x86_64-unknown-linux-musl ;;
    Darwin*) target=x86_64-apple-darwin ;;
    *)
      echo ">>> wasm-bindgen $1: no prebuilt binary for $(uname -sm)" >&2
      return 1
      ;;
  esac
  url="https://github.com/rustwasm/wasm-bindgen/releases/download/$1/wasm-bindgen-$1-$target.tar.gz"
  curl -fsSL "$url" \
    | tar -xzf - -C "$2" --strip-components=1 "wasm-bindgen-$1-$target/wasm-bindgen" "wasm-bindgen-$1-$target/wasm-bindgen-test-runner" \
    || { echo ">>> wasm-bindgen $1: prebuilt $url unusable, compiling instead" >&2; return 1; }
}

# $1: version, $2: destination. --locked keeps the crate's own Cargo.lock; unlocked, the pinned Cargo resolves dependencies it cannot build.
cargo_install_wasm_bindgen() {
  local root="$2.cargo"
  cargo install wasm-bindgen-cli --version "$1" --locked --root "$root"
  mv "$root/bin/wasm-bindgen" "$root/bin/wasm-bindgen-test-runner" "$2"
  rm -rf "$root"
}

# $1: version. Leaves wasm-bindgen and wasm-bindgen-test-runner in $WASM_BINDGEN_ROOT/<version>.
install_wasm_bindgen() {
  local dir="$WASM_BINDGEN_ROOT/$1"
  if wasm_bindgen_reports "$dir" "$1"; then
    echo ">>> wasm-bindgen $1: cached"
    return
  fi
  mkdir -p "$dir"
  if download_wasm_bindgen "$1" "$dir" && wasm_bindgen_reports "$dir" "$1"; then
    echo ">>> wasm-bindgen $1: prebuilt"
    return
  fi
  cargo_install_wasm_bindgen "$1" "$dir"
  if ! wasm_bindgen_reports "$dir" "$1"; then
    echo ">>> wasm-bindgen $1: $dir/wasm-bindgen does not report that version" >&2
    return 1
  fi
  echo ">>> wasm-bindgen $1: cargo install --locked"
}

build_wasm_packages() {
  mkdir -p "$CARGO_HOME" "$RUSTUP_HOME" "$CARGO_TARGET_DIR"

  if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
    # Version comes from wasm/rust-toolchain.toml so the initial `cargo install wasm-pack`
    # has a working toolchain before per-package rust-toolchain.toml files apply.
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --default-toolchain "$RUST_VERSION" --profile minimal --target wasm32-unknown-unknown
  fi
  rustup default "$RUST_VERSION"

  # One package at a time, its wasm-bindgen first on PATH: wasm-pack takes a matching binary from PATH; otherwise
  # it downloads a prebuilt tarball and, when that fails, runs an unlocked `cargo install` that the pinned toolchain cannot build.
  local package version
  for package in "${WASM_PACKAGES[@]}"; do
    # Its own line: set -e ignores a failure inside a command substitution used as an argument.
    version=$(wasm_bindgen_version "$package")
    install_wasm_bindgen "$version"
    PATH="$WASM_BINDGEN_ROOT/$version:$PATH" bash ../wasm/build.sh "$package"
  done
}

# $1: tar to write. Older archives cannot match again and count against the Build Cache size limit.
pack_wasm_packages() {
  rm -rf "$WASM_CACHE"
  mkdir -p "$WASM_CACHE"
  (cd ../wasm && tar -cf "$1" */pkg)
  du -sh "$1"
}

# $1: wasm key. Leaves the packages under ../wasm, from the cheapest source that has them.
restore_wasm_packages() {
  local key="$1" archive="$WASM_CACHE/$1.tar"

  if [ -f "$archive" ] && readable_archive "$archive" "wasm packages"; then
    echo ">>> wasm packages: HIT in Build Cache ($key)"
    # A build restored from Build Cache seeds Remote Cache when it lacks the tar.
    remote_has "$key" || remote_upload "$key" "$archive" "wasm packages"
  elif remote_fetch "$key" "$archive" && readable_archive "$archive" "wasm packages"; then
    echo ">>> wasm packages: HIT in Remote Cache ($key)"
  else
    echo ">>> wasm packages: MISS in Build Cache and Remote Cache ($key), building"
    build_wasm_packages
    pack_wasm_packages "$archive"
    # Uploaded before yarn install and the client build, so a build that later
    # exceeds Vercel's time limit still leaves the packages behind for the next one.
    remote_upload "$key" "$archive" "wasm packages"
  fi

  tar -xf "$archive" -C ../wasm
}

# rustup without a default toolchain: generate-default-crates installs the one it reads.
ensure_rustup() {
  mkdir -p "$CARGO_HOME" "$RUSTUP_HOME"
  [ -x "$CARGO_HOME/bin/rustup" ] && return
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --default-toolchain none --profile minimal
}

# Leaves the default crates in public/crates, from the cheapest source that has them. The
# generator's own key covers its inputs; hashed again with a prefix so it never equals a wasm key.
restore_default_crates() {
  local inputs key archive
  # Its own line: set -e ignores a failure inside a command substitution used as an argument.
  inputs=$(node scripts/generate-default-crates.mjs --key)
  key=$(printf 'default-crates-%s' "$inputs" | sha256 | cut -d' ' -f1)
  archive="$DEFAULT_CRATES_CACHE/$key.tar.gz"

  if [ -f "$archive" ] && readable_archive "$archive" "default crates"; then
    echo ">>> default crates: HIT in Build Cache ($key)"
    remote_has "$key" || remote_upload "$key" "$archive" "default crates"
  elif remote_fetch "$key" "$archive" && readable_archive "$archive" "default crates"; then
    echo ">>> default crates: HIT in Remote Cache ($key)"
  else
    echo ">>> default crates: MISS in Build Cache and Remote Cache ($key), generating"
    ensure_rustup
    node scripts/generate-default-crates.mjs
    rm -rf "$DEFAULT_CRATES_CACHE"
    mkdir -p "$DEFAULT_CRATES_CACHE"
    (cd "$CRATES_DIR" && tar -czf "$archive" "${DEFAULT_CRATE_FILES[@]}")
    du -sh "$archive"
    remote_upload "$key" "$archive" "default crates"
  fi

  mkdir -p "$CRATES_DIR"
  tar -xzf "$archive" -C "$CRATES_DIR"
}

# $1: wasm key. Yarn copies the ../wasm packages into node_modules, so a restored copy is
# current only for the same lockfile, manifest, wasm packages, and Node version.
install_node_modules() {
  local key
  key=$(cat yarn.lock package.json | sha256 | cut -d' ' -f1)-$1-$(node --version)

  if [ -f "$INSTALL_MARK" ] && [ "$(cat "$INSTALL_MARK")" = "$key" ]; then
    echo ">>> node_modules: current copy in Build Cache, skipping yarn install"
    return
  fi
  # Over a restored tree from another install key the build failed on @noble/hashes/sha3 and a clean install built; .cache alone is what the wasm and crate restores create
  if [ -d node_modules ] && [ -n "$(find node_modules -mindepth 1 -maxdepth 1 ! -name .cache -print -quit)" ]; then
    echo ">>> node_modules: Build Cache copy has another install key, clearing all but .cache before yarn install"
    find node_modules -mindepth 1 -maxdepth 1 ! -name .cache -exec rm -rf {} +
  fi
  yarn install --frozen-lockfile
  mkdir -p "$(dirname "$INSTALL_MARK")"
  printf '%s' "$key" >"$INSTALL_MARK"
}

main() {
  local wasm_key
  wasm_key=$(wasm_source_key)
  report_remote_credentials
  restore_wasm_packages "$wasm_key"
  restore_default_crates
  install_node_modules "$wasm_key"
}

main "$@"
