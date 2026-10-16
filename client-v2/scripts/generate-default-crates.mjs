#!/usr/bin/env node
// Generate the default crates (`core`, `alloc`, `std`) for Rust Analyzer.
// Nothing else makes them: `generate-crates` only keeps existing copies, and upstream's copies have no recorded recipe.
//
// Usage: `generate-default-crates.mjs` generates, or exits early when `KEY_PATH` matches;
// `generate-default-crates.mjs --key` prints the key and exits.

import path from "path";
import fs from "fs/promises";
import zlib from "zlib";
import crypto from "crypto";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { execFileSync, spawnSync } from "child_process";

import {
  CLIENT_PATH,
  REPO_ROOT_PATH,
  exists,
  skipWithoutTool,
} from "./utils.mjs";

/** Crates output directory path */
const CRATES_PATH = path.join(CLIENT_PATH, "public", "crates");

/** Key of the inputs the default crates in `CRATES_PATH` were generated from */
const KEY_PATH = path.join(CRATES_PATH, ".default-crates-key");

/** Toolchain file the Rust Analyzer wasm is built with */
const TOOLCHAIN_PATH = path.join(
  REPO_ROOT_PATH,
  "wasm",
  "rust-analyzer",
  "rust-toolchain.toml"
);

/** `syn-file-expand-cli` name */
const CLI_NAME = "syn-file-expand-cli";

/** The `generate-crates` release is built on `syn` 2, which cannot parse the `box` expressions in `std` */
const CLI_VERSION = "0.2.0";

/** Flags per crate; `core` drops the AVX-512 variant of a module with two `#[path]`s */
const CRATES = {
  core: ["--unset-cfg", "all(target_arch=x86_64,target_feature=avx512f)"],
  alloc: [],
  std: [],
};

/** Every file this script writes, the key included; `clearSupportedCrates` in `generate-crates.mjs` keeps the same list */
const OUTPUT_FILES = [
  ...Object.keys(CRATES).flatMap((name) => [`${name}.rs`, `${name}.rs.br`]),
  path.basename(KEY_PATH),
];

// The brotli copies' bytes come from the brotli bundled with Node, so run only on the pinned Node
const nodeVersion = (
  await fs.readFile(path.join(CLIENT_PATH, ".nvmrc"), "utf8")
).trim();
if (process.versions.node.split(".")[0] !== nodeVersion.split(".")[0]) {
  throw new Error(
    `Node ${process.versions.node} is running; .nvmrc pins ${nodeVersion}. Run \`nvm use\` in client-v2`
  );
}

// Upstream pairs its analyzer with older default crates; one toolchain for both keeps APIs stabilized in between resolvable
const toolchainFile = await fs.readFile(TOOLCHAIN_PATH, "utf8");
const channel = toolchainFile.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
if (!channel) throw new Error(`No \`channel\` in ${TOOLCHAIN_PATH}`);

// The script's own source carries the tool version and the flags
const key = crypto
  .createHash("sha256")
  .update(await fs.readFile(fileURLToPath(import.meta.url)))
  .update("\0")
  .update(toolchainFile)
  .update("\0")
  .update(process.versions.brotli)
  .digest("hex");

if (process.argv.includes("--key")) {
  console.log(key);
  process.exit(0);
}

const outputsExist = (
  await Promise.all(OUTPUT_FILES.map((f) => exists(path.join(CRATES_PATH, f))))
).every(Boolean);
if (outputsExist && (await fs.readFile(KEY_PATH, "utf8")).trim() === key) {
  console.log(`Default crates are current (${key}). Skipping...`);
  process.exit(0);
}

skipWithoutTool("rustup", "the default crates");

// A run that fails halfway must not leave the old key beside new files
await fs.rm(KEY_PATH, { force: true });

// The self-update check fails when CARGO_HOME does not hold the rustup binary.
run("rustup", [
  "toolchain",
  "install",
  channel,
  "--no-self-update",
  "--profile",
  "minimal",
  "--component",
  "rust-src",
]);
const libraryPath = path.join(
  execFileSync("rustc", [`+${channel}`, "--print", "sysroot"], {
    encoding: "utf8",
  }).trim(),
  "lib",
  "rustlib",
  "src",
  "rust",
  "library"
);

// A root of its own, so it never shadows the release `generate-crates` installs
const cargoHome = process.env.CARGO_HOME ?? path.join(homedir(), ".cargo");
const cliRoot = path.join(cargoHome, "tools", `${CLI_NAME}-${CLI_VERSION}`);
const cliPath = path.join(cliRoot, "bin", CLI_NAME);
if (!(await exists(cliPath))) {
  // `+channel`: the default toolchain, where one exists, is not the analyzer's
  run("cargo", [
    `+${channel}`,
    "install",
    CLI_NAME,
    "--version",
    CLI_VERSION,
    "--locked",
    "--root",
    cliRoot,
  ]);
}

await fs.mkdir(CRATES_PATH, { recursive: true });
for (const [name, flags] of Object.entries(CRATES)) {
  const outPath = path.join(CRATES_PATH, `${name}.rs`);
  run(cliPath, [
    path.join(libraryPath, name, "src", "lib.rs"),
    "--loopify",
    "--cfg-true-by-default",
    "--unset-cfg",
    "test",
    ...flags,
    "--output",
    outPath,
  ]);

  // Quality 11 compresses ~30% below gzip -9; window 24 is the largest every browser decodes
  const source = await fs.readFile(outPath);
  await fs.writeFile(
    `${outPath}.br`,
    zlib.brotliCompressSync(source, {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    })
  );
  console.log({
    name,
    toolchain: channel,
    node: process.versions.node,
    brotli: process.versions.brotli,
  });
}

// Written last, so an interrupted run never looks current
await fs.writeFile(KEY_PATH, `${key}\n`);

/** Run a command and throw with its output when it fails. */
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const reason = result.error ?? result.signal ?? `exit ${result.status}`;
    throw new Error(
      `\`${command} ${args.join(" ")}\` failed (${reason}):\n${
        result.stderr || result.stdout || ""
      }`
    );
  }
}
