// Names every value two environment files share, without printing a value.
//
//   node scripts/env-overlap.mjs [--allow NAME,NAME] <preview.env> <production.env>
//
// The check behind HOO-2816's "a preview's build environment holds no value
// that production uses": pull the Preview environment of the project previews
// build on and production's environment, then run this on the two files. A
// value is compared across names too, since a preview's proxy secret equal to
// production's AUTH_SECRET is as bad as one name holding one value. Public
// names (REACT_APP_*, which ship in the bundle, and Vercel's own VERCEL_*),
// boolean flags and empty values are skipped; `--allow` skips more names, for
// public settings both sides share on purpose (a build server URL). Exits 1
// when anything overlaps, 2 when a file cannot be read or holds no entry, 3
// when nothing overlaps but some values were empty and went uncompared.
// How it is run: docs/deploy-client-vercel.md, "Sign-in on previews".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A dotenv file as `vercel env pull` and `doppler secrets download --format
 * env` write it: `NAME=value`, optional `export `, quotes stripped, `#` lines
 * skipped. No escapes or multi-line values: neither tool writes them for ours.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export const parseEnv = (text) => {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line
    );
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
};

const FLAG = /^(true|false|0|1|yes|no|on|off)$/i;
// Vercel's own VERCEL_* are deployment facts, except a token or a secret
const isPublic = (name) =>
  name.startsWith("REACT_APP_") ||
  (name.startsWith("VERCEL_") && !/TOKEN|SECRET|KEY/.test(name));

/**
 * The pairs of names, one per side, that hold the same compared value.
 * Curried on the allowed names, so `overlap` below is the common case.
 *
 * @param {Set<string>} allow names never compared
 * @returns {(a: Record<string, string>, b: Record<string, string>) => [string, string][]}
 */
export const overlapAllowing = (allow) => (a, b) => {
  const compared = (env) =>
    Object.entries(env).filter(
      ([name, value]) =>
        value !== "" && !FLAG.test(value) && !isPublic(name) && !allow.has(name)
    );
  const pairs = [];
  for (const [nameA, valueA] of compared(a)) {
    for (const [nameB, valueB] of compared(b)) {
      if (valueA === valueB) pairs.push([nameA, nameB]);
    }
  }
  return pairs;
};

/** {@link overlapAllowing} with no extra name skipped */
export const overlap = overlapAllowing(new Set());

/** The file's entries, or why it cannot be compared */
const readEnvFile = (path) => {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return { error: `${path}: cannot read (${e.code ?? e.message})` };
  }
  const env = parseEnv(text);
  // A file that parses to nothing compares as clean; say so rather than pass
  return Object.keys(env).length
    ? { env }
    : { error: `${path}: no NAME=value line, nothing to compare` };
};

const main = (argv) => {
  const allow = new Set();
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--allow") {
      for (const name of (argv[++i] ?? "").split(",")) {
        if (name) allow.add(name);
      }
    } else paths.push(argv[i]);
  }
  if (paths.length !== 2) {
    console.error(
      "usage: env-overlap.mjs [--allow NAME,NAME] <preview.env> <production.env>"
    );
    return 2;
  }
  const read = paths.map(readEnvFile);
  const errors = read.filter((r) => r.error);
  if (errors.length) {
    for (const { error } of errors) console.error(`env-overlap: ${error}`);
    return 2;
  }
  const [a, b] = read.map((r) => r.env);
  // An empty value is a Sensitive one `vercel env pull` could not read: name
  // each one, so a clean run is not mistaken for a full one
  const empty = [a, b].map((env) =>
    Object.keys(env).filter((name) => env[name] === "")
  );
  const pairs = overlapAllowing(allow)(a, b);
  for (const [nameA, nameB] of pairs) {
    console.log(`shared: ${nameA} (${paths[0]}) = ${nameB} (${paths[1]})`);
  }
  console.log(
    `${pairs.length} shared value(s) across ${Object.keys(a).length} and ` +
      `${Object.keys(b).length} names`
  );
  empty.forEach((names, i) => {
    if (names.length) {
      console.log(`not compared, empty in ${paths[i]}: ${names.join(", ")}`);
    }
  });
  if (pairs.length) return 1;
  return empty.some((names) => names.length) ? 3 : 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
