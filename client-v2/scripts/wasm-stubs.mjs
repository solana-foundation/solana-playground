// The Node declaration of the stub switch; scripts/wasm-stubs.sh is the shell one. Both must agree with wasm/stub-packages.sh.
import fs from "node:fs";
import path from "node:path";

export const USE_WASM_STUBS = "USE_WASM_STUBS";

/** The version wasm/stub-packages.sh writes into every stub's package.json. */
export const WASM_STUB_VERSION = "0.0.0-stub";

/** Text every stub CLI throws, and so text a bundle built from a stub carries. */
export const WASM_STUB_MARKER = "local dev stub";

/** The wasm-bindgen module each real package ships; no stub has one, and the rust-analyzer stub carries no {@link WASM_STUB_MARKER}. */
export const REAL_WASM_MARKERS = [
  "anchor_cli_wasm_bg",
  "rust_analyzer_wasm_bg",
  "seahorse_compile_wasm_bg",
  "solana_cli_wasm_bg",
  "spl_token_cli_wasm_bg",
  "sugar_cli_wasm_bg",
];

// No import.meta: the e2e spec imports this module, and Playwright compiles it to CommonJS. yarn runs the CLI in client-v2.
const CLIENT_DIR = process.cwd();

/**
 * Only the exact string `true` opts in, so a stray `1` still means the real packages.
 *
 * @param {Record<string, string | undefined>} env
 */
export const wasmStubsRequested = (env) => env[USE_WASM_STUBS] === "true";

/**
 * Names of the packages whose manifest is a stub's.
 *
 * @param {{ name: string, manifest: { version?: string } }[]} packages
 * @returns {string[]}
 */
export const stubbedPackages = (packages) =>
  packages
    .filter(({ manifest }) => manifest.version === WASM_STUB_VERSION)
    .map(({ name }) => name);

/**
 * Why a built bundle cannot ship: a file that carries a stub, or a real package no file carries.
 *
 * @param {{ path: string, text: string }[]} files the bundle's JavaScript
 * @returns {string[]} one line per problem, empty when the bundle is real
 */
export const bundleProblems = (files) => {
  const problems = files
    .filter(({ text }) => text.includes(WASM_STUB_MARKER))
    .map((file) => `${file.path} contains "${WASM_STUB_MARKER}"`);
  for (const marker of REAL_WASM_MARKERS) {
    if (!files.some(({ text }) => text.includes(marker))) {
      problems.push(`no file contains "${marker}"`);
    }
  }
  return problems;
};

const readInstalledPackages = () => {
  const scope = path.join(CLIENT_DIR, "node_modules", "@solana-playground");
  if (!fs.existsSync(scope)) return [];
  return fs
    .readdirSync(scope)
    .filter((name) => fs.existsSync(path.join(scope, name, "package.json")))
    .map((name) => ({
      name,
      manifest: JSON.parse(
        fs.readFileSync(path.join(scope, name, "package.json"), "utf8")
      ),
    }));
};

const readBundle = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    // Some bundled package folders are named `*.js` themselves
    .filter(
      (file) =>
        file.endsWith(".js") && fs.statSync(path.join(dir, file)).isFile()
    )
    .map((file) => ({
      path: path.join(dir, file),
      text: fs.readFileSync(path.join(dir, file), "utf8"),
    }));

// Exit codes and messages for the scripts that serve or test the app, which must not run on stubs nobody asked for.
const guard = (script) => {
  const stubs = stubbedPackages(readInstalledPackages());
  if (stubs.length === 0) return 0;
  if (wasmStubsRequested(process.env)) {
    console.log(
      `${USE_WASM_STUBS}=true: using wasm stubs for ${stubs.join(", ")}`
    );
    return 0;
  }
  console.error(
    `yarn ${script}: node_modules/@solana-playground holds stubs for ${stubs.join(
      ", "
    )}.\n` +
      `Run \`yarn setup\` for the real packages, or \`${USE_WASM_STUBS}=true yarn ${script}\` to run on the stubs.`
  );
  return 1;
};

const checkBuild = (dir) => {
  const problems = bundleProblems(readBundle(dir));
  for (const problem of problems) console.error(`wasm packages: ${problem}`);
  if (problems.length > 0) {
    console.error(
      `wasm packages: ${dir} lacks a real wasm package; it must not be deployed`
    );
    return 1;
  }
  console.log(`wasm packages: ${dir} carries the real packages`);
  return 0;
};

const main = ([command, arg]) => {
  if (command === "guard" && arg) return guard(arg);
  if (command === "check-build")
    return checkBuild(path.resolve(arg ?? "build"));
  console.error("usage: wasm-stubs.mjs guard <script> | check-build [dir]");
  return 2;
};

if (path.basename(process.argv[1] ?? "") === "wasm-stubs.mjs") {
  process.exitCode = main(process.argv.slice(2));
}
