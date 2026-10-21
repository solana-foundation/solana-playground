import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  REAL_WASM_MARKERS,
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

const chunkOf = (marker) => ({
  path: `${marker}.js`,
  text: `import './${marker}.js'`,
});
const stubChunk = { path: "stub.js", text: `is a ${WASM_STUB_MARKER}. Run` };

for (const [label, files, expected] of [
  [
    "passes a bundle with every real package",
    REAL_WASM_MARKERS.map(chunkOf),
    0,
  ],
  [
    "rejects a bundle that carries a stub",
    REAL_WASM_MARKERS.map(chunkOf).concat(stubChunk),
    1,
  ],
  [
    "rejects a bundle without one real package",
    REAL_WASM_MARKERS.filter((m) => m !== "rust_analyzer_wasm_bg").map(chunkOf),
    1,
  ],
]) {
  test(`bundleProblems ${label}`, () => {
    assert.equal(bundleProblems(files).length, expected);
  });
}

const script = fileURLToPath(new URL("./wasm-stubs.mjs", import.meta.url));

// A client folder whose only installed wasm package is a stub; the guard reads node_modules from its cwd.
const stubbedClient = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-stubs-"));
  const pkg = path.join(
    dir,
    "node_modules",
    "@solana-playground",
    "solana-cli"
  );
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({ version: WASM_STUB_VERSION })
  );
  return dir;
};

for (const [label, env, expected] of [
  ["refuses stubs nobody asked for", { PATH: process.env.PATH }, 1],
  [
    "allows stubs under USE_WASM_STUBS=true",
    { PATH: process.env.PATH, USE_WASM_STUBS: "true" },
    0,
  ],
]) {
  test(`guard ${label}`, (t) => {
    const cwd = stubbedClient();
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const run = spawnSync(process.execPath, [script, "guard", "dev"], {
      cwd,
      env,
    });
    assert.equal(run.status, expected, run.stderr.toString());
  });
}
