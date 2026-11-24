#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=wasm-stubs.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/wasm-stubs.sh"

# Vercel install hook for the client.
#
# Order matters: client/package.json has file-deps like "../wasm/solana-cli/pkg"
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

# $1: artifact key, $2: destination. A failed or broken-off download leaves no partial file to be read as a hit.
remote_fetch() {
  remote_enabled || return 1
  mkdir -p "$(dirname "$2")"
  local status
  # curl's own exit code too: a transfer that breaks off after a 200 still prints 200.
  if ! status=$(curl -sS -H "Authorization: Bearer $REMOTE_TOKEN" -w '%{http_code}' -o "$2.part" "$(remote_url "$1")"); then
    echo ">>> Remote Cache: download of $1 broke off, treated as a miss" >&2
    rm -f "$2.part"
    return 1
  fi
  if remote_found "$1" "$status"; then
    mv "$2.part" "$2"
  else
    rm -f "$2.part"
    return 1
  fi
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

SEAL_SCRIPT="$(dirname -- "${BASH_SOURCE[0]}")/cache-seal.mjs"

# A production deployment takes back only archives a production build sealed (HOO-2887): Remote Cache
# is writable by anyone holding its token, and every build of the team holds it. See scripts/cache-seal.mjs.
is_production_build() {
  [ "${VERCEL_ENV:-}" = production ]
}

# $1: cache key. Production stores under names derived from CACHE_SEAL_KEY, so no other build writes
# them by accident, and rotating the secret moves production to names with no entries yet: that is how a
# build stopped by a seal that does not match recovers. The names are not secret (the log prints them);
# the seal is what stops a deliberate write. printf is a builtin, so the secret never reaches an argv.
cache_key() {
  if is_production_build; then
    printf 'production-%s-%s' "$CACHE_SEAL_KEY" "$1" | sha256 | cut -d' ' -f1
  else
    printf '%s' "$1"
  fi
}

# $1: artifact key, $2: archive. Prints the artifact key of its seal, named by the archive's content as well,
# so two production builds that overlap can never pair one's archive with the other's seal.
seal_key() {
  local digest
  digest=$(sha256 <"$2" | cut -d' ' -f1)
  printf 'seal-%s-%s' "$1" "$digest" | sha256 | cut -d' ' -f1
}

# $1: artifact key, $2: archive, $3: what it holds, for the log. Outside production every copy passes.
# In production a copy without a seal is discarded and treated as a miss; any other failed check stops the build.
seal_holds() {
  is_production_build || return 0
  local verdict status=0
  if [ ! -f "$2.seal" ]; then
    echo ">>> $3: $(basename "$2") has no seal, discarding" >&2
    rm -f "$2"
    return 1
  fi
  # The script prints `sealed` on a match: an exit 0 without it is no verdict.
  verdict=$(node "$SEAL_SCRIPT" verify "$1" "$2" "$2.seal") || status=$?
  if [ "$status" -eq 0 ] && [ "$verdict" = sealed ]; then
    return 0
  fi
  case "$status:$verdict" in
    1:mismatch) echo ">>> $3: $(basename "$2") does not match its seal; production never builds from it. Someone other than a production build wrote this cache entry. Rotate CACHE_SEAL_KEY to rebuild under new names (docs/deploy-client-vercel.md, \"Sealed production cache\")." >&2 ;;
    0:*) echo ">>> $3: the seal check of $(basename "$2") gave no verdict; stopping" >&2 ;;
    *) echo ">>> $3: the seal check of $(basename "$2") failed (exit $status); stopping" >&2 ;;
  esac
  exit 1
}

# $1: artifact key, $2: archive. Succeeds when Remote Cache holds the archive and, in production, its seal.
remote_holds() {
  remote_has "$1" || return 1
  is_production_build || return 0
  remote_has "$(seal_key "$1" "$2")"
}

# $1: artifact key, $2: archive, $3: what it holds, for the log. Succeeds when $2 holds a copy this build may use,
# from Build Cache first, then Remote Cache.
restore_archive() {
  if [ -f "$2" ] && seal_holds "$1" "$2" "$3" && readable_archive "$2" "$3"; then
    echo ">>> $3: HIT in Build Cache ($1)"
    # A build restored from Build Cache seeds Remote Cache when it lacks the archive, uploading the seal it just checked.
    remote_holds "$1" "$2" || upload_archive "$1" "$2" "$3"
    return 0
  fi
  rm -f "$2.seal"
  if remote_fetch "$1" "$2"; then
    if is_production_build && ! remote_fetch "$(seal_key "$1" "$2")" "$2.seal"; then
      echo ">>> $3: no seal for the Remote Cache copy of $1 could be fetched (a failed request, a production build that stopped between its two uploads, or a write from outside production). Rebuilding" >&2
    elif seal_holds "$1" "$2" "$3" && readable_archive "$2" "$3"; then
      echo ">>> $3: HIT in Remote Cache ($1)"
      return 0
    fi
  fi
  rm -f "$2" "$2.seal"
  return 1
}

# $1: artifact key, $2: archive. Writes $2.seal. Any failure stops the build: it may run where set -e does not
# reach, and an empty seal would stop every later build instead.
seal_archive() {
  local seal
  if ! seal=$(node "$SEAL_SCRIPT" sign "$1" "$2") || ! [[ "$seal" =~ ^[0-9a-f]{64}$ ]]; then
    echo ">>> could not seal $(basename "$2"); stopping" >&2
    exit 1
  fi
  printf '%s\n' "$seal" >"$2.seal"
}

# $1: artifact key, $2: archive, $3: what it holds, for the log. Uploads the archive and, in production, its seal.
upload_archive() {
  remote_upload "$1" "$2" "$3"
  if is_production_build; then
    remote_upload "$(seal_key "$1" "$2")" "$2.seal" "$3 seal"
  fi
}

# $1: artifact key, $2: a freshly built archive, $3: what it holds, for the log.
store_archive() {
  if is_production_build; then
    seal_archive "$1" "$2"
  fi
  upload_archive "$1" "$2" "$3"
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

# $1: package. Prints the toolchain that builds it: its own rust-toolchain.toml when it has one, else the workspace's.
package_toolchain() {
  local file="../wasm/$1/rust-toolchain.toml"
  if [ -f "$file" ]; then
    # Matches wasm/build.sh's parsing of the same file.
    awk '/channel/{gsub(/"/, ""); print $3 }' "$file"
  else
    printf '%s' "$RUST_VERSION"
  fi
}

# $1: version, $2: destination, $3: toolchain. --locked keeps the crate's own Cargo.lock; unlocked, Cargo resolves the newest dependencies, which the toolchain may not build.
cargo_install_wasm_bindgen() {
  local root="$2.cargo"
  # The toolchain of the package that pins this version: a later Rust refuses to compile wasm-bindgen below 0.2.88.
  rustup toolchain install "$3" --profile minimal
  cargo "+$3" install wasm-bindgen-cli --version "$1" --locked --root "$root"
  mv "$root/bin/wasm-bindgen" "$root/bin/wasm-bindgen-test-runner" "$2"
  rm -rf "$root"
}

# $1: version, $2: package that resolves it. Leaves wasm-bindgen and wasm-bindgen-test-runner in $WASM_BINDGEN_ROOT/<version>.
install_wasm_bindgen() {
  local dir="$WASM_BINDGEN_ROOT/$1" toolchain
  if wasm_bindgen_reports "$dir" "$1"; then
    echo ">>> wasm-bindgen $1: cached"
    return
  fi
  mkdir -p "$dir"
  if download_wasm_bindgen "$1" "$dir" && wasm_bindgen_reports "$dir" "$1"; then
    echo ">>> wasm-bindgen $1: prebuilt"
    return
  fi
  # Its own line: set -e ignores a failure inside a command substitution used as an argument.
  toolchain=$(package_toolchain "$2")
  cargo_install_wasm_bindgen "$1" "$dir" "$toolchain"
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
  # it downloads a prebuilt tarball and, when that fails, runs an unlocked `cargo install`, whose newest dependencies the toolchain may not build.
  local package version
  # WASM_PACKAGES is declared in wasm-stubs.sh.
  for package in $WASM_PACKAGES; do
    # Its own line: set -e ignores a failure inside a command substitution used as an argument.
    version=$(wasm_bindgen_version "$package")
    install_wasm_bindgen "$version" "$package"
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
  local key archive
  # Its own line: set -e ignores a failure inside a command substitution used as an argument.
  key=$(cache_key "$1")
  archive="$WASM_CACHE/$key.tar"

  if ! restore_archive "$key" "$archive" "wasm packages"; then
    echo ">>> wasm packages: MISS in Build Cache and Remote Cache ($key), building"
    build_wasm_packages
    pack_wasm_packages "$archive"
    # Uploaded before yarn install and the client build, so a build that later
    # exceeds Vercel's time limit still leaves the packages behind for the next one.
    store_archive "$key" "$archive" "wasm packages"
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
  key=$(cache_key "$key")
  archive="$DEFAULT_CRATES_CACHE/$key.tar.gz"

  if ! restore_archive "$key" "$archive" "default crates"; then
    echo ">>> default crates: MISS in Build Cache and Remote Cache ($key), generating"
    ensure_rustup
    node scripts/generate-default-crates.mjs
    rm -rf "$DEFAULT_CRATES_CACHE"
    mkdir -p "$DEFAULT_CRATES_CACHE"
    (cd "$CRATES_DIR" && tar -czf "$archive" "${DEFAULT_CRATE_FILES[@]}")
    du -sh "$archive"
    store_archive "$key" "$archive" "default crates"
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
  # webpack's own cache too, as scripts/setup-wasm.sh does: rebuilt wasm packages keep their name and version, so
  # the cache would serve modules built from the packages the old install held (a production one may be unsealed).
  rm -rf node_modules/.cache/default-development node_modules/.cache/default-production
  yarn install --frozen-lockfile
  mkdir -p "$(dirname "$INSTALL_MARK")"
  printf '%s' "$key" >"$INSTALL_MARK"
}

main() {
  local wasm_key install_key
  if wasm_stubs_requested; then
    echo ">>> USE_WASM_STUBS=true: a deployment never ships wasm stubs; unset it" >&2
    exit 1
  fi
  # Production refuses to start without its seal secret rather than build from an unverified cache.
  if is_production_build && [ "$(node "$SEAL_SCRIPT" check)" != ready ]; then
    exit 1
  fi
  wasm_key=$(wasm_source_key)
  report_remote_credentials
  restore_wasm_packages "$wasm_key"
  restore_default_crates
  # Production keys the install by the sealed name, so a node_modules installed from an unsealed archive
  # before the seal existed is installed again, from the packages just checked.
  install_key=$(cache_key "$wasm_key")
  install_node_modules "$install_key"
}

# Sourced, it sets the Rust environment and defines the functions without running main: reusable-client-v2.yml keys and builds with wasm_source_key and build_wasm_packages.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
