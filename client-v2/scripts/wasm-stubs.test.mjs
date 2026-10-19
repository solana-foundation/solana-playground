import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WASM_STUB_MARKER,
  WASM_STUB_VERSION,
  bundleProblems,
  stubbedPackages,
  wasmStubsRequested,
} from "./wasm-stubs.mjs";

for (const [label, env, expected] of [
  ["opts in on the exact string true", { USE_WASM_STUBS: "true" }, true],
  ["needs the exact string true", { USE_WASM_STUBS: "1" }, false],
]) {
  test(`wasmStubsRequested ${label}`, () => {
    assert.equal(wasmStubsRequested(env), expected);
  });
}

test("stubbedPackages names only the stubs", () => {
  assert.deepEqual(
    stubbedPackages([
      { name: "solana-cli", manifest: { version: WASM_STUB_VERSION } },
      { name: "anchor-cli", manifest: { version: "0.29.0" } },
    ]),
    ["solana-cli"]
  );
});

for (const [label, files, expected] of [
  [
    "passes a bundle with the real solana-cli",
    [{ path: "a.js", text: "import './solana_cli_wasm_bg.js'" }],
    0,
  ],
  [
    "rejects a bundle that carries a stub",
    [
      { path: "a.js", text: "import './solana_cli_wasm_bg.js'" },
      { path: "b.js", text: `is a ${WASM_STUB_MARKER}. Run` },
    ],
    1,
  ],
  [
    "rejects a bundle without the real solana-cli",
    [{ path: "a.js", text: "console.log(1)" }],
    1,
  ],
]) {
  test(`bundleProblems ${label}`, () => {
    assert.equal(bundleProblems(files).length, expected);
  });
}
