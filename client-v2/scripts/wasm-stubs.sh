# Sourced, never run, and POSIX sh so Makefile.vercel can source it. Its Node twin is scripts/wasm-stubs.mjs.

# all_packages in wasm/build.sh, which does not export it: the packages compiled from Rust, and so the ones a stub replaces.
WASM_PACKAGES="anchor-cli rust-analyzer seahorse-compile solana-cli spl-token-cli sugar-cli"

# The version wasm/stub-packages.sh writes into every stub's package.json.
WASM_STUB_VERSION="0.0.0-stub"

# Only the exact string `true` opts in, so a stray `1` or `yes` still builds the real packages.
wasm_stubs_requested() {
  [ "${USE_WASM_STUBS:-}" = true ]
}

# Text every stub CLI throws.
WASM_STUB_MARKER="local dev stub"

# $1: a package.json. Succeeds when it is one wasm/stub-packages.sh wrote.
is_wasm_stub_manifest() {
  [ -f "$1" ] && grep -q "\"version\": \"$WASM_STUB_VERSION\"" "$1"
}

# $1: a wasm/<pkg>/pkg folder. Also true for a real build written over a stub, which keeps the stub's index.js.
holds_wasm_stub() {
  is_wasm_stub_manifest "$1/package.json" || grep -qs "$WASM_STUB_MARKER" "$1/index.js"
}

# $1: the client directory. yarn 1 re-copies a file: package only when its folder is missing, whatever changed in wasm/*/pkg.
remove_installed_wasm_packages() {
  for _wasm_package in $WASM_PACKAGES; do
    rm -rf "$1/node_modules/@solana-playground/$_wasm_package"
  done
}
