#!/usr/bin/env bash
#
# stub-packages.sh — write placeholder packages into the six wasm/<name>/pkg
# folders that wasm/build.sh compiles from Rust, for UI-only development.
#
# NOT GATED: run, this script writes the stubs whatever USE_WASM_STUBS says.
# The gate is its one caller, client-v2/scripts/setup-wasm.sh, which runs it
# only under USE_WASM_STUBS=true (the `:with-stubs` scripts and the manual
# client-v2-with-stubs.yml). Every default path builds the real packages, so
# never call this script from one. A stub written by hand reaches node_modules
# at the next install into an empty folder; from there `yarn start`, `dev`,
# `build-fast` and `test-e2e` refuse it, and `check-build` fails a bundle
# that carries one.
#
# `yarn install` refuses to run while these folders are missing, and a real
# build takes about an hour on a cold target. A stub loses Rust intellisense in
# the editor and the `solana`, `anchor`, `spl-token`, `sugar` terminal commands
# plus Seahorse (Python) builds. The UI, Monaco, rustfmt, Playnet (local
# validator), the wallet, and Rust program builds via the build server work.
#
# Usage: yarn --cwd client-v2 setup:with-stubs
# Back to the real packages: yarn --cwd client-v2 setup
#
set -euo pipefail

# shellcheck source=../client-v2/scripts/wasm-stubs.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/../client-v2/scripts/wasm-stubs.sh"

root="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)}"
wasm_dir="$root/wasm"
[ -d "$wasm_dir" ] || { echo "no wasm/ directory under $root" >&2; exit 1; }

write_pkg() { # write_pkg <dir> <npm-name>
  mkdir -p "$wasm_dir/$1/pkg"
  cat > "$wasm_dir/$1/pkg/package.json" <<JSON
{
  "name": "$2",
  "version": "$WASM_STUB_VERSION",
  "description": "Local UI-dev stub. Real package: yarn --cwd client-v2 setup",
  "module": "index.js",
  "main": "index.js",
  "types": "index.d.ts",
  "sideEffects": false,
  "files": ["index.js", "index.d.ts"]
}
JSON
}

stub_cli() { # stub_cli <dir> <exported-fn>
  write_pkg "$1" "@solana-playground/$1-stub"
  cat > "$wasm_dir/$1/pkg/index.js" <<JS
const notBuilt = () => {
  throw new Error(
    "\`$1\` is a $WASM_STUB_MARKER. Run \`yarn --cwd client-v2 setup\` to build and " +
      "install the real WASM packages if you need this command."
  );
};

export function $2() {
  return notBuilt();
}
JS
  echo "export declare function $2(...args: any[]): any;" > "$wasm_dir/$1/pkg/index.d.ts"
  echo "  stubbed $1"
}

stub_cli solana-cli       runSolana
stub_cli anchor-cli       runAnchor
stub_cli spl-token-cli    runSplToken
stub_cli sugar-cli        runSugar
stub_cli seahorse-compile compileSeahorse

# Rust Analyzer needs to resolve successfully: initRustAnalyzer retries worker
# creation forever if it fails. Return empty-but-well-shaped results so the
# Monaco providers do not throw. Methods must be synchronous — the worker posts
# the return value straight back and a Promise is not structured-cloneable.
write_pkg rust-analyzer "@solana-playground/rust-analyzer-stub"
cat > "$wasm_dir/rust-analyzer/pkg/index.js" <<'JS'
const LIST_METHODS = new Set([
  "codeLenses",
  "completions",
  "definition",
  "documentSymbols",
  "foldingRanges",
  "goToImplementation",
  "inlayHints",
  "loadDependency",
  "references",
  "rename",
  "typeDefinition",
]);

export default async function init() {}

export async function initThreadPool() {}

export class WorldState {
  constructor() {
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "then") return undefined;
          return () => {
            if (prop === "update") return { diagnostics: [] };
            if (LIST_METHODS.has(prop)) return [];
            return null;
          };
        },
      }
    );
  }
}
JS
cat > "$wasm_dir/rust-analyzer/pkg/index.d.ts" <<'DTS'
export default function init(): Promise<void>;
export function initThreadPool(threads?: number): Promise<void>;
export declare class WorldState {
  constructor();
  [key: string]: any;
}
DTS
echo "  stubbed rust-analyzer"

echo
echo "Done."
