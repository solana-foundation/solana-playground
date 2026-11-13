import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  bundleProblems,
  REAL_WASM_MARKERS,
  stubbedPackages,
  WASM_STUB_MARKER,
  WASM_STUB_VERSION,
  wasmStubsRequested,
} from "./wasm-stubs.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(scriptsDir, "..", "..");

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
      { name: "sugar-cli", manifest: { version: "0.1.0" } },
    ]),
    ["solana-cli"]
  );
});

// Named as webpack names a chunk, so only the text can carry a marker.
const chunkOf = (marker, index) => ({
  path: `build/static/js/${index}.0a1b2c3d.chunk.js`,
  text: `import './${marker}.js'`,
});
const stubChunk = {
  path: "build/static/js/99.0a1b2c3d.chunk.js",
  text: `is a ${WASM_STUB_MARKER}. Run`,
};

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

const script = path.join(scriptsDir, "wasm-stubs.mjs");

// A client folder with one installed wasm package at `version`; the guard reads node_modules from its cwd.
const clientWith = (version) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-stubs-"));
  const pkg = path.join(
    dir,
    "node_modules",
    "@solana-playground",
    "solana-cli"
  );
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ version }));
  return dir;
};

for (const [label, version, env, expected] of [
  [
    "refuses stubs nobody asked for",
    WASM_STUB_VERSION,
    { PATH: process.env.PATH },
    1,
  ],
  [
    "allows stubs under USE_WASM_STUBS=true",
    WASM_STUB_VERSION,
    { PATH: process.env.PATH, USE_WASM_STUBS: "true" },
    0,
  ],
  ["allows real packages", "0.1.0", { PATH: process.env.PATH }, 0],
]) {
  test(`guard ${label}`, (t) => {
    const cwd = clientWith(version);
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const run = spawnSync(process.execPath, [script, "guard", "dev"], {
      cwd,
      env,
    });
    assert.equal(run.status, expected, run.stderr.toString());
  });
}

const shellValue = (name) =>
  execFileSync("bash", [
    "-c",
    `. "${path.join(scriptsDir, "wasm-stubs.sh")}" && printf %s "$${name}"`,
  ]).toString();

test("the stub writer, both declarations, and wasm/build.sh agree", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-stub-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "wasm"));
  execFileSync("bash", [path.join(rootDir, "wasm", "stub-packages.sh"), root]);

  const packages = shellValue("WASM_PACKAGES").split(" ");
  const built = fs
    .readFileSync(path.join(rootDir, "wasm", "build.sh"), "utf8")
    .match(/all_packages=\(([^)]*)\)/)[1]
    .match(/"[^"]+"/g)
    .map((name) => name.slice(1, -1));
  const written = fs.readdirSync(path.join(root, "wasm")).map((name) => ({
    name,
    manifest: JSON.parse(
      fs.readFileSync(path.join(root, "wasm", name, "pkg", "package.json"))
    ),
  }));

  assert.equal(shellValue("WASM_STUB_VERSION"), WASM_STUB_VERSION);
  assert.equal(shellValue("WASM_STUB_MARKER"), WASM_STUB_MARKER);
  assert.deepEqual(built.toSorted(), packages.toSorted());
  assert.deepEqual(stubbedPackages(written).toSorted(), packages.toSorted());
  assert.deepEqual(
    REAL_WASM_MARKERS.toSorted(),
    packages.map((name) => `${name.replaceAll("-", "_")}_wasm_bg`).toSorted()
  );
  for (const name of packages.filter(
    (packageName) => packageName !== "rust-analyzer"
  )) {
    assert.match(
      fs.readFileSync(path.join(root, "wasm", name, "pkg", "index.js"), "utf8"),
      new RegExp(WASM_STUB_MARKER)
    );
  }
});
