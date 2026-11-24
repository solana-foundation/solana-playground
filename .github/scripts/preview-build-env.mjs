// Turns the Preview environment `vercel pull` writes (.vercel/.env.preview.local)
// into the one a labelled PR's preview is built with (preview.yml, job
// `build`), which runs the PR's code and its dependencies, so it must hold no
// secret: the file travels to that job as a workflow artifact, which anyone who
// can read the repository can download.
//
// - A public name keeps its value: REACT_APP_* is compiled into the bundle, so
//   it is public by construction; the VERCEL_* names below describe the
//   deployment, not a credential; DB_PROVIDER names a kind of database;
//   NODE_OPTIONS and NODE_ENV configure the build's tools; and the build reads
//   SENTRY_PREVIEW_ENABLED and SOURCEMAPS_PREVIEW_ENABLED (scripts/sentry-gate.mjs,
//   scripts/sourcemap-gate.mjs) as flags and PUBLIC_ENV_RESTRICTED_KEYS
//   (scripts/public-env.mjs) as a list of names, which a placeholder would
//   change.
// - Every other name keeps its name with a placeholder value, or "" when it
//   was empty. For those the build only checks that they are set
//   (client-v2/scripts/check-agent-env.mjs), and the deployed functions read
//   the real values from the Vercel project at runtime.
// - A name whose value the build uses as more than "set" is dropped, since a
//   placeholder would be read as the value: SOURCES, which check-agent-env.mjs
//   parses, and SENTRY_AUTH_TOKEN, which upload-sourcemaps.mjs would send to
//   Sentry (without it a labelled preview uploads no source maps).
//   VERCEL_OIDC_TOKEN is a credential and is dropped too.
// - A public value equal to a secret one fails the run: public-env.mjs, which
//   refuses such a value in the bundle, only sees placeholders in this build.
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
  "SENTRY_PREVIEW_ENABLED",
  "SOURCEMAPS_PREVIEW_ENABLED",
  "PUBLIC_ENV_RESTRICTED_KEYS",
]);
const DROPPED_NAMES = new Set([
  "SOURCES",
  "SENTRY_AUTH_TOKEN",
  "VERCEL_OIDC_TOKEN",
]);

const isPublic = (name) =>
  PUBLIC_NAMES.has(name) || PUBLIC_PREFIXES.some((p) => name.startsWith(p));

const isEmpty = (value) => /^\s*(""|'')?\s*$/.test(value);

/** @param {string} text an env file @returns {[string, string][]} its NAME=value lines as pairs */
const entriesOf = (text) =>
  text.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    return match ? [[match[1], match[2]]] : [];
  });

/**
 * @param {string} text the pulled env file
 * @returns {string[]} each public name whose value equals a secret one, as `PUBLIC = SECRET`
 */
export const publicSecrets = (text) => {
  const entries = entriesOf(text).filter(([, value]) => !isEmpty(value));
  const secret = new Map(
    entries.filter(([name]) => !isPublic(name)).map(([name, v]) => [v, name])
  );
  return entries
    .filter(([name, value]) => isPublic(name) && secret.has(value))
    .map(([name, value]) => `${name} = ${secret.get(value)}`);
};

/** @param {string} text the pulled env file @returns {string} the build's env file */
export function buildEnv(text) {
  const out = [];
  for (const [name, value] of entriesOf(text)) {
    if (DROPPED_NAMES.has(name)) continue;
    if (isPublic(name)) out.push(`${name}=${value}`);
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
  const pulled = readFileSync(input, "utf8");
  const leaks = publicSecrets(pulled);
  if (leaks.length) {
    for (const leak of leaks)
      console.error(
        `::error::a public variable holds a secret's value: ${leak}`
      );
    process.exit(1);
  }
  writeFileSync(output, buildEnv(pulled));
}
