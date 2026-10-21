#!/usr/bin/env bash
#
# stub-packages.sh — create placeholder WASM packages for UI-only development.
#
# The client depends on 8 local packages under wasm/*/pkg. Two of them
# (playnet, rustfmt) are committed prebuilt; the other 6 are compiled from
# Rust by wasm/build.sh, which takes roughly an hour. If you are only working
# on the React UI you do not need them, but `yarn install` still refuses to
# run while the directories are missing.
#
# This script writes minimal stand-ins so install and the dev build succeed.
# What you lose: Rust intellisense in the editor and the `solana`, `anchor`,
# `spl-token`, `sugar` terminal commands plus Seahorse (Python) builds.
# What still works: the whole UI, Monaco, rustfmt, Playnet (local validator),
# wallet, and Rust program builds via the build server.
#
# Usage: yarn --cwd client-v2 setup:with-stubs, which runs this under USE_WASM_STUBS=true and installs.
#
# To switch back to the real packages: yarn --cwd client-v2 setup
#
set -euo pipefail

root="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)}"
wasm_dir="$root/wasm"
[ -d "$wasm_dir" ] || { echo "no wasm/ directory under $root" >&2; exit 1; }

write_pkg() { # write_pkg <dir> <npm-name>
  mkdir -p "$wasm_dir/$1/pkg"
  cat > "$wasm_dir/$1/pkg/package.json" <<JSON
{
  "name": "$2",
  "version": "0.0.0-stub",
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
    "\`$1\` is a local dev stub. Run \`yarn --cwd client-v2 setup\` to build and " +
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
