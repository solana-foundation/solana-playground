// Generate Rust Analyzer's crates for the dev server, unless Rust Analyzer is a stub or absent.
//
// The dev server answers a missing `public/crates` file with `index.html` (CRA's
// history fallback), so the real analyzer needs them; a stub never asks. Both
// generators exit early when their key matches, so only a machine's first run,
// or one after `Cargo.lock` or the toolchain moves, takes minutes (about ten
// for the first). `generate-default-crates` runs only on the Node `.nvmrc`
// pins. Without cargo or rustup they warn and skip outside CI.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CLIENT_PATH } from "./utils.mjs";
import { stubbedPackages } from "./wasm-stubs.mjs";

const NAME = "rust-analyzer";
const CRATES_PATH = path.join(CLIENT_PATH, "public", "crates");

const manifestPath = path.join(
  CLIENT_PATH,
  "node_modules",
  "@solana-playground",
  NAME,
  "package.json"
);
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : undefined;

if (
  manifest === undefined ||
  stubbedPackages([{ name: NAME, manifest }]).length > 0
) {
  console.log(
    "Rust Analyzer is not installed or is a stub, so its crates are not generated. Skipping..."
  );
  process.exit(0);
}

const isFirstRun = [".crates-key", ".default-crates-key"].some(
  (key) => !fs.existsSync(path.join(CRATES_PATH, key))
);
if (isFirstRun) {
  console.log(
    "Generating Rust Analyzer's crates; a machine's first run takes about ten minutes..."
  );
}

// `generate-crates` first: it clears every crate file but the default crates'
for (const script of ["generate-crates.mjs", "generate-default-crates.mjs"]) {
  const result = spawnSync(
    process.execPath,
    [path.join(CLIENT_PATH, "scripts", script)],
    { stdio: "inherit" }
  );
  if (result.status === 0) continue;

  // A run that did not exit (killed, or never started) is not a toolchain problem
  if (result.status === null) {
    console.error(
      `${script} did not finish (${result.error ?? result.signal}).`
    );
    process.exit(1);
  }
  // CI restores current crates, so a failure there is real
  if (process.env.CI) process.exit(result.status);
  // A local toolchain problem must not keep the dev server down; Rust
  // Analyzer turns itself off, or skips the crate, with a warning instead
  console.warn(
    `${script} failed (above), so the dev server starts without those crates; retry with \`yarn ${script.replace(
      ".mjs",
      ""
    )}\`.`
  );
}
