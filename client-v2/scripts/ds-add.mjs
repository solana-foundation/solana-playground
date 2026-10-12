// Installs or reinstalls design-system components into `shared/ui`:
//
//   yarn ds-add <name...> [--dry-run | --diff | --view]
//
// Builds the registry in ../design-system, serves it on the port
// components.json maps `@playground` to, runs the shadcn CLI the design
// system pins with `--overwrite` (the CLI never overwrites silently, and
// `shared/ui` is installed, never edited), stops the server, and formats what
// landed with this package's prettier, so CI's format check passes and a
// reinstall of an unchanged component leaves no diff.
//
// Nothing comes from the design system's public site or from ui.shadcn.com:
// the stock shadcn parts are registry items too, and
// `scripts/registry.test.mjs` fails on a dependency named outside
// `@playground/`. npm dependencies still come from npm.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DS = path.resolve(CLIENT, "../design-system");
const SHADCN = path.join(DS, "node_modules/.bin/shadcn");
const PRETTIER = path.join(CLIENT, "node_modules/.bin/prettier");
// The port is read from the `@playground` URL in components.json, so the
// server and shadcn cannot disagree on it.
const PORT = new URL(
  JSON.parse(
    readFileSync(path.join(CLIENT, "components.json"), "utf8")
  ).registries["@playground"]
).port;
const SERVER_START_MS = 10_000;
// Where components.json's aliases and the registry's file targets write, and
// the `tailwind.css` file shadcn adds an item's `cssVars` to.
const INSTALLED = ["src/shared", "src/styles", "src/index.css"];
// The shadcn flags that preview instead of writing. Only these pass through,
// and only bare: a value given to one (`--diff src/x.tsx`) would be read here
// as a component name.
const PREVIEW_FLAGS = ["--dry-run", "--diff", "--view"];
const USAGE = `Usage: yarn ds-add <name...> [${PREVIEW_FLAGS.join(" | ")}]`;

const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith("-"));
const flags = args.filter((a) => a.startsWith("-"));
// A registry name; anything else (`--diff src/x.tsx`) is a misplaced value.
const unknown = [
  ...flags.filter((f) => !PREVIEW_FLAGS.includes(f)),
  ...names.filter((n) => !/^[a-z0-9-]+$/.test(n)),
];

if (names.length === 0 || unknown.length > 0) {
  if (unknown.length > 0) console.error(`ds-add: unknown ${unknown.join(" ")}`);
  console.error(USAGE);
  process.exit(1);
}
if (!existsSync(SHADCN)) fail(`run \`npm ci\` in ${DS} first.`);
if (!existsSync(PRETTIER)) fail(`run \`yarn install\` in ${CLIENT} first.`);

const built = run("npm", ["run", "build:registry"], { cwd: DS });
if (built !== 0) process.exit(built);

const server = await startServer().catch((err) => fail(err.message));
// shadcn reports a server that died mid-install only as a refused
// connection, so the death is noted here to name the cause.
let serverStopped = false;
server.once("exit", () => (serverStopped = true));
let status;
try {
  status = await runAsync(
    SHADCN,
    [
      "add",
      ...names.map((n) => `@playground/${n}`),
      "--overwrite",
      "--yes",
      ...flags,
    ],
    { cwd: CLIENT }
  );
} finally {
  if (serverStopped) {
    console.error("ds-add: the registry server stopped during the install.");
  }
  server.kill();
}
// A preview wrote nothing, so there is nothing to format.
if (status !== 0 || flags.length > 0) process.exit(status);

const written = INSTALLED.filter((dir) => existsSync(path.join(CLIENT, dir)));
if (written.length > 0) {
  status = run(PRETTIER, ["--write", "--loglevel=warn", ...written], {
    cwd: CLIENT,
  });
  if (status !== 0) {
    console.error(
      "ds-add: the components were installed, but formatting them failed. " +
        "Fix the error above and run `yarn format`."
    );
  }
}
process.exit(status);

/** Runs a command to completion and says why when it did not run cleanly. */
function run(cmd, cmdArgs, opts) {
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
  if (result.error) {
    console.error(`ds-add: could not run ${cmd}: ${result.error.message}`);
  } else if (result.signal) {
    console.error(`ds-add: ${cmd} was stopped by ${result.signal}`);
  }
  return result.status ?? 1;
}

/** `run` without blocking the event loop, so the server's exit is seen. */
function runAsync(cmd, cmdArgs, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: "inherit", ...opts });
    child.once("error", (err) => {
      console.error(`ds-add: could not run ${cmd}: ${err.message}`);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      if (signal) console.error(`ds-add: ${cmd} was stopped by ${signal}`);
      resolve(code ?? 1);
    });
  });
}

function fail(message) {
  console.error(`ds-add: ${message}`);
  process.exit(1);
}

/**
 * Starts the design system's registry server and resolves once it listens.
 *
 * The server binds 127.0.0.1, the host components.json names. On macOS a
 * dev server on *:3010 therefore does not intercept; on Linux that dev
 * server makes the bind fail. A busy port on 127.0.0.1 is an error,
 * not something to reuse: another worktree's server would serve that
 * worktree's registry without a word. The server sends one IPC message once
 * it listens (any message counts, so no text has to match), and it exits
 * when the channel closes, so it never outlives this process however this
 * process ends.
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/serve-registry.mjs"], {
      cwd: DS,
      env: { ...process.env, PORT },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `the registry server did not start in ${SERVER_START_MS / 1000}s.`
        )
      );
    }, SERVER_START_MS);
    child.once("message", () => {
      clearTimeout(timer);
      resolve(child);
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`could not start the registry server: ${err.message}`));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      // The server prints its own error first; exit code 1 is the one it
      // uses for a failed bind.
      const hint =
        code === 1
          ? ` Is port ${PORT} taken? ` +
            `\`lsof -nP -iTCP:${PORT} -sTCP:LISTEN\` names the holder.`
          : "";
      reject(
        new Error(
          `the registry server exited before it listened (${
            signal ?? code
          }).${hint}`
        )
      );
    });
  });
}
