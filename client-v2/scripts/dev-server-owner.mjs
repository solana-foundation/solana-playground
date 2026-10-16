// Tells whether the dev server on a port belongs to this worktree's
// client-v2. A local e2e run used to reuse whatever answered on the port,
// often another worktree's server, and reported false passes and failures
// (HOO-2106). `craco.config.js` makes the dev server name its own root in
// `DEV_SERVER_ROOT_HEADER`; `playwright.config.mts` asks `decideDevServer`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Response header the client-v2 dev server names its own root in. */
export const DEV_SERVER_ROOT_HEADER = "X-Dev-Server-Root";

/**
 * How long the probe waits for an answer. A dev server recompiling while other
 * dev servers load the same laptop can take seconds to answer; a timeout
 * refuses the run as silent, so too short a value rejects this worktree's own
 * healthy server.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

/** Thrown by `decideDevServer` when the run must not use the port. */
export class DevServerRefusal extends Error {
  name = "DevServerRefusal";
}

/**
 * `silent`: something accepted the connection but did not answer in time, so
 * it cannot be proven to be this worktree's server, nor shown to be another's.
 *
 * @typedef {{ kind: "free" }
 *   | { kind: "ours" }
 *   | { kind: "foreign", root: string | null, detail?: string }
 *   | { kind: "silent", timeoutMs: number }} PortOwner
 */

// A path that cannot be resolved here (another machine's, a deleted worktree,
// one below a file or one we may not read) still compares as text, and then it
// never matches ours; any filesystem error must not abort the probe.
const resolveRoot = (value) => {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
};

// The header travels percent-encoded so any path is a legal header value. A
// value that does not decode was not sent by our dev server; it is compared
// as written.
const decodeRoot = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Asks the server on `port` whose it is.
 *
 * @param {{ port: number, root: string, timeoutMs?: number }} options
 * @returns {Promise<PortOwner>}
 */
export async function whoseServer({
  port,
  root,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
}) {
  let response;
  try {
    response = await fetch(`http://localhost:${port}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return { kind: "free" };
    // The server may be this worktree's own, busy recompiling; the run must
    // not reuse it unproven, and its message says to retry rather than blaming
    // another worktree.
    if (error.name === "TimeoutError") return { kind: "silent", timeoutMs };
    // A reset or another network error means something holds the port but does
    // not answer like our dev server, so the run must not reuse it nor start
    // on top of it. The cause goes into the refusal so it can be told apart.
    return {
      kind: "foreign",
      root: null,
      detail: error.cause?.code ?? error.message,
    };
  }

  const sent = response.headers.get(DEV_SERVER_ROOT_HEADER);
  if (sent === null) return { kind: "foreign", root: null };
  const theirs = decodeRoot(sent);
  if (resolveRoot(theirs) === resolveRoot(root)) return { kind: "ours" };
  return { kind: "foreign", root: theirs };
}

/**
 * The same answer, synchronously, for a config file that is evaluated
 * synchronously: runs this module as a child `node` and parses its stdout.
 *
 * `script` and `graceMs` exist so a test can point the child at another
 * script and shorten the wait past the child's own.
 *
 * @param {{ port: number, root: string, timeoutMs?: number, script?: string,
 *   graceMs?: number }} options
 * @returns {PortOwner}
 * @throws {DevServerRefusal} when the child times out, fails or prints no JSON
 */
export function whoseServerSync({
  port,
  root,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  script = fileURLToPath(import.meta.url),
  graceMs = 5_000,
}) {
  const child = spawnSync(
    process.execPath,
    [script, String(port), root, String(timeoutMs)],
    // The child's own wait is `timeoutMs`; this one is a little longer, so the
    // config load can never hang on a stuck child.
    { encoding: "utf8", timeout: timeoutMs + graceMs }
  );
  if (child.error?.code === "ETIMEDOUT") {
    throw new DevServerRefusal(silentServerMessage({ port, timeoutMs }));
  }
  const failure = (why) =>
    new DevServerRefusal(
      `The probe of port ${port} for ${root} failed: ${why}\n` +
        "The e2e run cannot tell whose server it is."
    );
  if (child.error) throw failure(child.error.message);
  if (child.signal) throw failure(`signal ${child.signal}`);
  if (child.status !== 0) {
    throw failure(`exit ${child.status}, ${child.stderr.trim()}`);
  }
  try {
    return JSON.parse(child.stdout);
  } catch {
    throw failure(`unreadable answer: ${child.stdout.trim()}`);
  }
}

const unknownHolder = (detail) => {
  const why = detail === undefined ? "" : `: ${detail}`;
  return (
    "a server that is not a client-v2 dev server of this worktree " +
    `(it sent no ${DEV_SERVER_ROOT_HEADER} header, or dropped the connection${why})`
  );
};

/**
 * The fail-fast message for a port held by something that is not this
 * worktree's dev server.
 *
 * @param {{ port: number, root: string | null, detail?: string }} options
 *   `root` is the other worktree's, when the server named it; `detail` is the
 *   network error, when the server dropped the connection
 * @returns {string}
 */
export function foreignServerMessage({ port, root, detail }) {
  const holder =
    root === null
      ? unknownHolder(detail)
      : `the client-v2 dev server of another worktree: ${root}`;
  return [
    `Port ${port} is held by ${holder}.`,
    "The e2e run will not reuse it. Pick a free port from your slot",
    "(13000 + 10k, docs/testing.md section 8) and run:",
    `  PORT=<free port> yarn test-e2e`,
  ].join("\n");
}

/**
 * The fail-fast message for a port whose server did not answer in time.
 *
 * @param {{ port: number, timeoutMs: number }} options
 * @returns {string}
 */
export function silentServerMessage({ port, timeoutMs }) {
  return [
    `The server on port ${port} did not answer within ${timeoutMs / 1000} s`,
    "(busy compiling, or hung), so the e2e run cannot tell whose it is.",
    "Retry once it is idle, or pick a free port and run:",
    `  PORT=<free port> yarn test-e2e`,
  ].join("\n");
}

/**
 * What the e2e run does with the port: "start" when nothing is there (the
 * runner starts the dev server), "reuse" for this worktree's own server.
 *
 * @param {{ port: number, root: string, timeoutMs?: number }} options
 * @returns {"start" | "reuse"}
 * @throws {DevServerRefusal} for any other server, or one that is silent
 */
export function decideDevServer({ port, root, timeoutMs }) {
  const owner = whoseServerSync({ port, root, timeoutMs });
  if (owner.kind === "free") return "start";
  if (owner.kind === "ours") return "reuse";
  if (owner.kind === "silent") {
    throw new DevServerRefusal(
      silentServerMessage({ port, timeoutMs: owner.timeoutMs })
    );
  }
  throw new DevServerRefusal(
    foreignServerMessage({ port, root: owner.root, detail: owner.detail })
  );
}

// No top-level await: craco.config.js `require`s this module, which Node
// refuses for an ES module that awaits at the top level.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [port, root, timeoutMs] = process.argv.slice(2);
  whoseServer({
    port: Number(port),
    root,
    timeoutMs: timeoutMs === undefined ? undefined : Number(timeoutMs),
  }).then(
    (owner) => console.log(JSON.stringify(owner)),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    }
  );
}
