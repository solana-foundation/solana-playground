// The production half of scripts/vercel-install.sh's cache (HOO-2887): what a production build takes back from
// Build Cache and Remote Cache. Runs the real script, sourced, in a scratch tree whose `curl` is a fake
// Remote Cache in a directory, with the wasm build and the crate generator replaced by ones that write a marker.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { sealFile, sealMatches, sealSecret } from "./cache-seal.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const installScript = path.join(scriptsDir, "vercel-install.sh");
const sealScript = path.join(scriptsDir, "cache-seal.mjs");
const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

// Serves GET, HEAD (-I) and PUT (-X PUT --data-binary @file) from $FAKE_REMOTE/<artifact key>. Like the real curl
// without -f, it exits 0 on a 404; the PUT path is called with -f and never fails here.
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
code=200
case "$method" in
  PUT) cp "$data" "$file" ;;
  HEAD) [ -f "$file" ] || code=404 ;;
  GET) if [ -f "$file" ]; then [ -n "$out" ] && cp "$file" "$out"; else code=404; fi ;;
esac
[ -n "$write" ] && printf '%s' "$code"
exit 0
`;

// Prints its key with --key; otherwise writes every file DEFAULT_CRATE_FILES names.
const FAKE_CRATE_GENERATOR = `import fs from "node:fs";
if (process.argv.includes("--key")) {
  console.log("crate-inputs");
} else {
  fs.mkdirSync("public/crates", { recursive: true });
  for (const name of ["core.rs", "core.rs.br", "alloc.rs", "alloc.rs.br", "std.rs", "std.rs.br", ".default-crates-key"]) {
    fs.writeFileSync(\`public/crates/\${name}\`, "generated-here\\n");
  }
}
`;

const scratchRoots = [];
after(() => {
  for (const root of scratchRoots)
    fs.rmSync(root, { recursive: true, force: true });
});

function scratchTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-install-"));
  scratchRoots.push(root);
  const client = path.join(root, "client-v2");
  const wasm = path.join(root, "wasm");
  const remote = path.join(root, "remote");
  const bin = path.join(root, "bin");
  const rustupBin = path.join(client, ".cache", "rust", "cargo", "bin");
  fs.mkdirSync(path.join(client, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(wasm, "solana-cli"), { recursive: true });
  fs.mkdirSync(remote);
  fs.mkdirSync(bin);
  fs.mkdirSync(rustupBin, { recursive: true });
  fs.writeFileSync(
    path.join(wasm, "rust-toolchain.toml"),
    '[toolchain]\nchannel = "1.75.0"\n'
  );
  fs.writeFileSync(path.join(wasm, "solana-cli", "lib.rs"), "// source\n");
  fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, { mode: 0o755 });
  fs.writeFileSync(path.join(rustupBin, "rustup"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(client, "scripts", "generate-default-crates.mjs"),
    FAKE_CRATE_GENERATOR
  );
  return { root, client, wasm, remote, bin };
}

/**
 * Sources the script and runs `body`; build_wasm_packages writes a pkg whose marker says it was built here.
 * @param {{ VERCEL_ENV?: string, CACHE_SEAL_KEY?: string }} env
 */
function run(tree, body, env) {
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
      PATH: `${tree.bin}:${process.env.PATH}`,
      HOME: tree.root,
      FAKE_REMOTE: tree.remote,
      VERCEL_ARTIFACTS_TOKEN: "token",
      VERCEL_ENV: env.VERCEL_ENV ?? "",
      CACHE_SEAL_KEY: env.CACHE_SEAL_KEY ?? "",
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const PRODUCTION = { VERCEL_ENV: "production", CACHE_SEAL_KEY: SECRET };
const PREVIEW = { VERCEL_ENV: "preview" };

const restoreWasm = `restore_wasm_packages "$(wasm_source_key)"`;
const noBuild = `build_wasm_packages() { echo REBUILT >&2; exit 9; }`;

function unpackedPkg(tree) {
  return fs
    .readFileSync(path.join(tree.wasm, "solana-cli", "pkg", "index.js"), "utf8")
    .trim();
}

/** Production's wasm archive key, and the seal key of `archive` under it. */
function productionNames(tree, archive, env = PRODUCTION) {
  const out = run(
    tree,
    `k=$(cache_key "$(wasm_source_key)"); s=$(seal_key "$k" ${JSON.stringify(
      archive
    )}); echo "$k $s"`,
    env
  ).stdout.trim();
  const [key, seal] = out.split(" ");
  return {
    archive: path.join(tree.remote, key),
    seal: path.join(tree.remote, seal),
  };
}

/** Clears what a fresh builder lacks: Build Cache and the unpacked packages. */
function freshBuilder(tree) {
  fs.rmSync(path.join(tree.client, "node_modules"), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(tree.wasm, "solana-cli", "pkg"), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(tree.client, "public"), { recursive: true, force: true });
}

/** A production build from an empty cache, then a fresh builder that finds only its upload. */
function seededByProduction() {
  const tree = scratchTree();
  const first = run(tree, `${restoreWasm}; restore_default_crates`, PRODUCTION);
  assert.equal(first.status, 0, first.stderr);
  freshBuilder(tree);
  return tree;
}

/** A tar of solana-cli/pkg whose index.js says `injected`. */
function injectedArchive(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "injected-"));
  scratchRoots.push(dir);
  fs.mkdirSync(path.join(dir, "solana-cli", "pkg"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "solana-cli", "pkg", "index.js"),
    "injected\n"
  );
  spawnSync("tar", ["-cf", file, "solana-cli/pkg"], { cwd: dir });
}

test("sealMatches accepts only the same key, secret and bytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-seal-"));
  scratchRoots.push(dir);
  const file = path.join(dir, "a.tar");
  fs.writeFileSync(file, "archive");
  const seal = await sealFile(SECRET, "key-1", file);
  assert.equal(await sealMatches(SECRET, "key-1", file, `${seal}\n`), true);
  assert.equal(await sealMatches(SECRET, "key-2", file, seal), false);
  assert.equal(await sealMatches(OTHER_SECRET, "key-1", file, seal), false);
  assert.equal(await sealMatches(SECRET, "key-1", file, "not hex"), false);
  assert.equal(
    await sealMatches(SECRET, "key-1", file, seal.slice(0, 62)),
    false
  );
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

test("runs cache-seal.mjs through a symlinked path and still refuses a wrong seal", () => {
  const tree = scratchTree();
  const link = path.join(tree.root, "seal-link.mjs");
  fs.symlinkSync(sealScript, link);
  const archive = path.join(tree.root, "a.tar");
  const seal = path.join(tree.root, "a.tar.seal");
  fs.writeFileSync(archive, "archive");
  fs.writeFileSync(seal, "0".repeat(64));
  const env = { PATH: process.env.PATH, CACHE_SEAL_KEY: SECRET };
  const verify = spawnSync("node", [link, "verify", "k", archive, seal], {
    encoding: "utf8",
    env,
  });
  assert.equal(verify.status, 1);
  assert.equal(verify.stdout, "");
  const check = spawnSync("node", [link, "check"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(check.status, 2);
  assert.notEqual(check.stdout.trim(), "ready");
});

test("stops a production build before any cache work without CACHE_SEAL_KEY", () => {
  const tree = scratchTree();
  const result = run(tree, "main", { VERCEL_ENV: "production" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CACHE_SEAL_KEY is unset/);
  assert.deepEqual(fs.readdirSync(tree.remote), []);
});

test("builds on an empty cache and uploads the archive with its seal", () => {
  const tree = scratchTree();
  const result = run(tree, restoreWasm, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /wasm packages: MISS in Build Cache and Remote Cache/
  );
  const local = fs.readdirSync(
    path.join(tree.client, "node_modules", ".cache", "wasm-pkg")
  );
  const archive = path.join(
    tree.client,
    "node_modules",
    ".cache",
    "wasm-pkg",
    local.find((n) => n.endsWith(".tar"))
  );
  const names = productionNames(tree, archive);
  assert.ok(fs.existsSync(names.archive), "archive uploaded");
  assert.ok(fs.existsSync(names.seal), "seal uploaded");
});

test("takes an untouched sealed entry from Remote Cache without building (happy path)", () => {
  const tree = seededByProduction();
  const result = run(tree, `${noBuild}; ${restoreWasm}`, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wasm packages: HIT in Remote Cache/);
  assert.equal(unpackedPkg(tree), "built-here");
});

test("takes its own Build Cache copy without building (happy path)", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restoreWasm, PRODUCTION).status, 0);
  const result = run(tree, `${noBuild}; ${restoreWasm}`, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wasm packages: HIT in Build Cache/);
});

test("stops when a Remote Cache archive was replaced after sealing (edge case)", () => {
  const tree = seededByProduction();
  // The attacker keeps the genuine seal and writes it under the new archive's seal name too.
  const { archive } = productionNames(tree, "/dev/null");
  const genuineSeal = fs.readFileSync(productionNames(tree, archive).seal);
  injectedArchive(archive);
  fs.writeFileSync(productionNames(tree, archive).seal, genuineSeal);

  const result = run(tree, restoreWasm, PRODUCTION);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match its seal/);
  assert.equal(
    fs.existsSync(path.join(tree.wasm, "solana-cli", "pkg")),
    false,
    "nothing was unpacked"
  );
});

test("rebuilds when a Remote Cache archive was replaced and its seal is missing", () => {
  const tree = seededByProduction();
  const { archive } = productionNames(tree, "/dev/null");
  injectedArchive(archive);
  const result = run(tree, restoreWasm, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wasm packages: MISS/);
  assert.equal(unpackedPkg(tree), "built-here");
});

test("stops when a Build Cache seal does not match (edge case)", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restoreWasm, PRODUCTION).status, 0);
  const cache = path.join(tree.client, "node_modules", ".cache", "wasm-pkg");
  const seal = fs.readdirSync(cache).find((name) => name.endsWith(".seal"));
  fs.writeFileSync(path.join(cache, seal), "0".repeat(64));
  const result = run(tree, restoreWasm, PRODUCTION);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match its seal/);
});

test("refuses a genuine archive replayed under another source tree's key", () => {
  const tree = seededByProduction();
  const { archive: oldArchive } = productionNames(tree, "/dev/null");
  const oldSeal = productionNames(tree, oldArchive).seal;
  fs.writeFileSync(
    path.join(tree.wasm, "solana-cli", "lib.rs"),
    "// changed source\n"
  );
  const replayed = productionNames(tree, oldArchive);
  fs.copyFileSync(oldArchive, replayed.archive);
  fs.copyFileSync(oldSeal, replayed.seal);

  const result = run(tree, restoreWasm, PRODUCTION);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match its seal/);
});

test("rebuilds under new names after CACHE_SEAL_KEY is rotated", () => {
  const tree = seededByProduction();
  const result = run(tree, restoreWasm, {
    VERCEL_ENV: "production",
    CACHE_SEAL_KEY: OTHER_SECRET,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wasm packages: MISS/);
});

test("never reads what a preview build stored", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restoreWasm, PREVIEW).status, 0);
  const previewKey = fs.readdirSync(tree.remote)[0];
  injectedArchive(path.join(tree.remote, previewKey));
  freshBuilder(tree);
  const result = run(tree, restoreWasm, PRODUCTION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /wasm packages: MISS in Build Cache and Remote Cache/
  );
  assert.equal(unpackedPkg(tree), "built-here");
});

test("keeps the unsealed cache for a preview build", () => {
  const tree = scratchTree();
  assert.equal(run(tree, restoreWasm, PREVIEW).status, 0);
  freshBuilder(tree);
  const result = run(tree, restoreWasm, PREVIEW);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /wasm packages: HIT in Remote Cache/);
  assert.equal(fs.readdirSync(tree.remote).length, 1, "one archive, no seal");
});

test("takes the default crates back sealed, and stops on a replaced crates archive", () => {
  const tree = seededByProduction();
  const hit = run(tree, "restore_default_crates", PRODUCTION);
  assert.equal(hit.status, 0, hit.stderr);
  assert.match(hit.stdout, /default crates: HIT in Remote Cache/);

  const crateKey = run(
    tree,
    `k=$(printf 'default-crates-%s' "$(node scripts/generate-default-crates.mjs --key)" | sha256 | cut -d' ' -f1); cache_key "$k"`,
    PRODUCTION
  ).stdout.trim();
  const crateArchive = path.join(tree.remote, crateKey);
  const sealName = run(
    tree,
    `seal_key ${JSON.stringify(crateKey)} ${JSON.stringify(crateArchive)}`,
    PRODUCTION
  ).stdout.trim();
  const genuineSeal = fs.readFileSync(path.join(tree.remote, sealName));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crates-"));
  scratchRoots.push(dir);
  fs.writeFileSync(path.join(dir, "std.rs"), "injected\n");
  spawnSync("tar", ["-czf", crateArchive, "std.rs"], { cwd: dir });
  const newSeal = run(
    tree,
    `seal_key ${JSON.stringify(crateKey)} ${JSON.stringify(crateArchive)}`,
    PRODUCTION
  ).stdout.trim();
  fs.writeFileSync(path.join(tree.remote, newSeal), genuineSeal);
  freshBuilder(tree);

  const result = run(tree, "restore_default_crates", PRODUCTION);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /default crates: .* does not match its seal/);
});
