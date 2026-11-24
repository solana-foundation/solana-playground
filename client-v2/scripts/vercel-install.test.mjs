// The production half of scripts/vercel-install.sh's cache (HOO-2887): what a production build takes back from
// Build Cache and Remote Cache. Runs the real script, sourced, in a scratch tree whose `curl` is a fake
// Remote Cache in a directory, with the wasm build replaced by one that writes a marker.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sealFile, sealMatches, sealSecret } from "./cache-seal.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const installScript = path.join(scriptsDir, "vercel-install.sh");
const SECRET = "a".repeat(64);

// Serves GET, HEAD (-I) and PUT (-X PUT --data-binary @file) from $FAKE_REMOTE/<artifact key>, and logs each request.
const FAKE_CURL = `#!/usr/bin/env bash
out="" write="" method=GET data="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -w) write="$2"; shift ;;
    -X) method="$2"; shift ;;
    -I) method=HEAD ;;
    -H) shift ;;
    --data-binary) data="\${2#@}"; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
name="\${url##*/artifacts/}"; name="\${name%%\\?*}"
file="$FAKE_REMOTE/$name"
echo "$method $name" >>"$FAKE_REMOTE.log"
code=200
case "$method" in
  PUT) cp "$data" "$file" ;;
  HEAD) [ -f "$file" ] || code=404 ;;
  GET) if [ -f "$file" ]; then [ -n "$out" ] && cp "$file" "$out"; else code=404; fi ;;
esac
[ -n "$write" ] && printf '%s' "$code"
[ "$code" = 200 ]
`;

function scratchTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-install-"));
  const client = path.join(root, "client-v2");
  const wasm = path.join(root, "wasm");
  const bin = path.join(root, "bin");
  fs.mkdirSync(client);
  fs.mkdirSync(path.join(wasm, "solana-cli"), { recursive: true });
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, "remote"));
  fs.writeFileSync(
    path.join(wasm, "rust-toolchain.toml"),
    '[toolchain]\nchannel = "1.75.0"\n'
  );
  fs.writeFileSync(path.join(wasm, "solana-cli", "lib.rs"), "// source\n");
  fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  return { root, client, wasm, remote: path.join(root, "remote") };
}

/** Sources the script and runs `body`; build_wasm_packages writes a pkg whose marker says who built it. */
function run(tree, body, env = {}) {
  const script = `
set -euo pipefail
. ${JSON.stringify(installScript)}
build_wasm_packages() {
  mkdir -p ../wasm/solana-cli/pkg
  echo built-here >../wasm/solana-cli/pkg/index.js
}
${body}
`;
  const result = spawnSync("bash", ["-c", script], {
    cwd: tree.client,
    encoding: "utf8",
    env: {
      PATH: `${path.join(tree.root, "bin")}:${process.env.PATH}`,
      HOME: tree.root,
      FAKE_REMOTE: tree.remote,
      VERCEL_ARTIFACTS_TOKEN: "token",
      ...env,
    },
  });
  return {
    ...result,
    log: fs.existsSync(`${tree.remote}.log`)
      ? fs.readFileSync(`${tree.remote}.log`, "utf8")
      : "",
  };
}

const PRODUCTION = { VERCEL_ENV: "production", CACHE_SEAL_KEY: SECRET };

const restore = `restore_wasm_packages "$(wasm_source_key)"; cat ../wasm/solana-cli/pkg/index.js`;

function pkg(tree) {
  return fs
    .readFileSync(path.join(tree.wasm, "solana-cli", "pkg", "index.js"), "utf8")
    .trim();
}

/** Production's entries in the fake Remote Cache: [archive key, seal key]. */
function productionEntries(tree) {
  const keys = run(
    tree,
    `k=$(cache_key "$(wasm_source_key)"); echo "$k $(seal_key "$k")"`,
    PRODUCTION
  ).stdout.trim();
  return keys.split(" ").map((key) => path.join(tree.remote, key));
}

/** A production build from an empty cache, then a fresh builder (no Build Cache) that finds its upload. */
function seededByProduction() {
  const tree = scratchTree();
  const first = run(tree, restore, PRODUCTION);
  assert.equal(first.status, 0, first.stderr);
  fs.rmSync(path.join(tree.client, "node_modules"), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(tree.wasm, "solana-cli", "pkg"), { recursive: true });
  return tree;
}

test("sealFile binds the cache key and the bytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-seal-"));
  const file = path.join(dir, "a.tar");
  fs.writeFileSync(file, "archive");
  const seal = await sealFile(SECRET, "key-1", file);
  assert.equal(await sealMatches(SECRET, "key-1", file, `${seal}\n`), true);
  assert.equal(await sealMatches(SECRET, "key-2", file, seal), false);
  assert.equal(await sealMatches("b".repeat(64), "key-1", file, seal), false);
  assert.equal(await sealMatches(SECRET, "key-1", file, "not hex"), false);
  fs.writeFileSync(file, "archivE");
  assert.equal(await sealMatches(SECRET, "key-1", file, seal), false);
});

test("sealSecret refuses an unset or short secret", () => {
  assert.throws(() => sealSecret({}), /CACHE_SEAL_KEY is unset/);
  assert.throws(
    () => sealSecret({ CACHE_SEAL_KEY: "short" }),
    /shorter than 32/
  );
  assert.equal(sealSecret({ CACHE_SEAL_KEY: SECRET }), SECRET);
});

test("production stops before any cache work without CACHE_SEAL_KEY", () => {
  const tree = scratchTree();
  const result = run(tree, "main", { VERCEL_ENV: "production" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CACHE_SEAL_KEY is unset/);
  assert.equal(result.log, "");
});

test("production builds on an empty cache and uploads the archive with its seal", () => {
  const tree = scratchTree();
  const result = run(tree, restore, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MISS in Build Cache and Remote Cache/);
  for (const entry of productionEntries(tree))
    assert.ok(fs.existsSync(entry), entry);
});

test("happy path: production takes an untouched sealed entry from Remote Cache without building", () => {
  const tree = seededByProduction();
  const result = run(
    tree,
    `build_wasm_packages() { echo REBUILT >&2; exit 9; }; ${restore}`,
    PRODUCTION
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HIT in Remote Cache/);
  assert.equal(pkg(tree), "built-here");
});

test("happy path: production takes its own Build Cache copy", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restore, PRODUCTION).status, 0);
  const result = run(
    tree,
    `build_wasm_packages() { exit 9; }; ${restore}`,
    PRODUCTION
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HIT in Build Cache/);
});

test("edge case: a Remote Cache archive replaced after sealing stops the production build", () => {
  const tree = seededByProduction();
  const [archive] = productionEntries(tree);
  const evil = scratchTree();
  fs.mkdirSync(path.join(evil.wasm, "solana-cli", "pkg"));
  fs.writeFileSync(
    path.join(evil.wasm, "solana-cli", "pkg", "index.js"),
    "injected\n"
  );
  spawnSync("tar", ["-cf", archive, "solana-cli/pkg"], { cwd: evil.wasm });

  const result = run(tree, restore, PRODUCTION);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match its seal/);
  assert.equal(
    fs.existsSync(path.join(tree.wasm, "solana-cli", "pkg")),
    false,
    "nothing was unpacked"
  );
});

test("edge case: a Build Cache copy whose seal does not match stops the production build", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restore, PRODUCTION).status, 0);
  const cache = path.join(tree.client, "node_modules", ".cache", "wasm-pkg");
  const seal = fs.readdirSync(cache).find((name) => name.endsWith(".seal"));
  fs.writeFileSync(path.join(cache, seal), "0".repeat(64));
  const result = run(tree, restore, PRODUCTION);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match its seal/);
});

test("edge case: an unsealed entry under production's key is rebuilt, never used", () => {
  const tree = seededByProduction();
  const [, seal] = productionEntries(tree);
  fs.rmSync(seal);
  const result = run(tree, restore, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MISS in Build Cache and Remote Cache/);
  assert.ok(fs.existsSync(seal), "the rebuild seals and uploads again");
});

test("production never reads what a preview build stored", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restore, { VERCEL_ENV: "preview" }).status, 0);
  fs.rmSync(path.join(tree.client, "node_modules"), {
    recursive: true,
    force: true,
  });
  const result = run(tree, restore, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MISS in Build Cache and Remote Cache/);
});

test("a preview build keeps the unsealed cache", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restore, { VERCEL_ENV: "preview" }).status, 0);
  fs.rmSync(path.join(tree.client, "node_modules"), {
    recursive: true,
    force: true,
  });
  const result = run(tree, restore, { VERCEL_ENV: "preview" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HIT in Remote Cache/);
  assert.equal(fs.readdirSync(tree.remote).length, 1, "one archive, no seal");
});
