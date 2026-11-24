// Turns the Preview environment `vercel pull` writes (.vercel/.env.preview.local)
// into the one a labelled PR's preview is built with (preview.yml, job
// `build`), which runs the PR's code and its dependencies, so it must hold no
// secret: the file travels to that job as a workflow artifact, which anyone who
// can read the repository can download.
//
// - A public name keeps its value: REACT_APP_* is compiled into the bundle, so
//   it is public by construction, the VERCEL_* names below describe the
//   deployment, not a credential, and NODE_OPTIONS and NODE_ENV configure
//   the build's tools, which a placeholder would break.
// - Every other name keeps its name with a placeholder value, or "" when it
//   was empty. The build only checks that the server's variables are set
//   (client-v2/scripts/check-agent-env.mjs) and compiles none of them in; the
//   deployed functions read the real values from the Vercel project at runtime.
// - A name whose value the build parses is dropped, since a placeholder would
//   fail the parse: SOURCES (check-agent-env.mjs). VERCEL_OIDC_TOKEN is a
//   credential and is dropped too.
//
// Lines that are not NAME=value (Vercel's header comment) are dropped.
//
// Usage: node preview-build-env.mjs <pulled env file> <output file>

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The value every non-public, non-empty variable gets in the build */
export const PLACEHOLDER = "set-in-vercel-not-in-this-build";

const PUBLIC_PREFIXES = ["REACT_APP_", "VERCEL_GIT_"];
const PUBLIC_NAMES = new Set([
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "DB_PROVIDER",
  "NODE_OPTIONS",
  "NODE_ENV",
]);
const DROPPED_NAMES = new Set(["SOURCES", "VERCEL_OIDC_TOKEN"]);

const isPublic = (name) =>
  PUBLIC_NAMES.has(name) || PUBLIC_PREFIXES.some((p) => name.startsWith(p));

const isEmpty = (value) => /^\s*(""|'')?\s*$/.test(value);

/** @param {string} text the pulled env file @returns {string} the build's env file */
export function buildEnv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, name, value] = match;
    if (DROPPED_NAMES.has(name)) continue;
    if (isPublic(name)) out.push(line);
    else out.push(`${name}="${isEmpty(value) ? "" : PLACEHOLDER}"`);
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error(
      "usage: preview-build-env.mjs <pulled env file> <output file>"
    );
    process.exit(2);
  }
  writeFileSync(output, buildEnv(readFileSync(input, "utf8")));
}
