// Keeps secrets out of the browser bundle.
//
// CRA defines `process.env` as one object holding every `REACT_APP_*`
// variable of the build (react-scripts/config/env.js, matched without regard
// to case). Third-party code reads `process.env.NODE_DEBUG` and the like, so
// webpack inlines that whole object, values included, wherever it does: every
// `REACT_APP_*` the build sees is public, read by our code or not.
//
// Two checks:
// - `publicEnvProblems`, from craco.config.js in every production build,
//   before webpack runs: a `REACT_APP_*` the client does not read, and a
//   public value outside its variable's shape (`VALUE_SHAPES`), shaped like
//   a token, or equal to a secret.
// - `check-build`, from `build:bundle` (every deployment's build) after
//   `craco build` and before the source maps go to Sentry: no file in
//   `build/` holds the value of a secret variable.
//
// Messages name variables, never their values: the build log is shared.
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { parseEnv } from "util";

import {
  isSecretQueryTerm,
  isTokenLike,
  queryTermsOf,
} from "../src/shared/lib/url-secret.mjs";
import { GA4_ID } from "./google-tag.mjs";
import { encodedForms } from "./lib/encoded-forms.mjs";

const CLIENT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// CRA's own `.env` parser and expander, so the scan looks for the values the build saw
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
const dotenvExpand = require("dotenv-expand");

/** CRA's test, which ignores case: `react_app_x` reaches the bundle too */
const isPublicName = (name) => /^REACT_APP_/i.test(name);

/**
 * Names of variables that hold credentials. `REACT_APP_*` names are public
 * by definition and never count.
 */
const isSecretName = (name) =>
  !isPublicName(name) &&
  (/SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|BYPASS/i.test(name) ||
    /(^|_)(API_)?KEY$/i.test(name) ||
    /^DATABASE_URL/i.test(name));

/** A connection string with a password, whatever its variable is named (`POSTGRES_URL`…) */
const hasUrlPassword = (value) =>
  URL.canParse(value) && new URL(value).password !== "";

/** Shorter values ("true", "1") would match by chance anywhere in a bundle */
const MIN_SECRET_LENGTH = 8;

/** Whether a variable holds a secret worth looking for */
const isSecretEntry = ([name, value]) =>
  typeof value === "string" &&
  value.length >= MIN_SECRET_LENGTH &&
  !isPublicName(name) &&
  (isSecretName(name) || hasUrlPassword(value));

/** Prefixes of tokens that never belong in a public value */
const TOKEN_PREFIXES = [
  "sk-",
  "sntrys_",
  "sntryu_",
  "ghp_",
  "gho_",
  "ghs_",
  "github_pat_",
  "xoxb-",
  "AKIA",
  "postgres://",
  "postgresql://",
  "-----BEGIN",
];

/**
 * The `REACT_APP_*` names the client reads: the literal member expressions in
 * `src/shared/config/client-env.ts`, the one module that reads them.
 *
 * @param {string} source that module's text
 * @returns {Set<string>}
 */
export const clientEnvNames = (source) =>
  new Set(
    [...source.matchAll(/process\.env\.(REACT_APP_[A-Z0-9_]+)/g)].map(
      (m) => m[1]
    )
  );

const readClientEnvNames = () =>
  clientEnvNames(
    fs.readFileSync(
      path.join(CLIENT_DIR, "src", "shared", "config", "client-env.ts"),
      "utf8"
    )
  );

/** Names listed in `PUBLIC_ENV_RESTRICTED_KEYS` */
const restrictedNames = (env) =>
  new Set(
    (env.PUBLIC_ENV_RESTRICTED_KEYS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  );

/** A user or password before the host, which no provider restricts to an origin */
const credentialProblems = (name, url) =>
  url.username || url.password
    ? [`${name} carries credentials before the host`]
    : [];

/**
 * Why the URL in `name` would publish a key: the query terms, path segments
 * and fragment `maskRpcUrl` masks, judged by the same `url-secret.mjs`. The
 * host is left out: a keyless provider hostname, such as a Helius "fast"
 * endpoint's, can hold a long label with a digit and read as a token.
 */
const keyProblems = (name, url) => [
  ...(queryTermsOf(url.search).some(([term, value]) =>
    isSecretQueryTerm(term, value)
  )
    ? [`${name} carries a credential in its query`]
    : []),
  ...(url.pathname.split("/").some(isTokenLike)
    ? [`${name} carries a token-shaped path segment`]
    : []),
  ...(isTokenLike(url.hash.slice(1))
    ? [`${name} carries a token-shaped fragment`]
    : []),
];

/**
 * Why `value` is outside the shape its variable holds; `[]` when it fits. A
 * name in `restricted` skips the key checks of a URL, never its credentials.
 *
 * @typedef {(name: string, value: string, restricted: Set<string>) => string[]} ShapeCheck
 */

/** @type {(pattern: RegExp, shape: string) => ShapeCheck} */
const checkWith = (pattern, shape) => (name, value) =>
  pattern.test(value) ? [] : [`${name} is not ${shape}`];

/** @type {ShapeCheck} */
// eslint-disable-next-line max-params -- one signature for every entry of VALUE_SHAPES
const publicUrl = (name, value, restricted) => {
  if (!URL.canParse(value)) return [`${name} is not a URL`];
  const url = new URL(value);
  return [
    ...credentialProblems(name, url),
    ...(restricted.has(name) ? [] : keyProblems(name, url)),
  ];
};

/** @type {ShapeCheck} */
const sentryDsn = (name, value) => {
  if (!URL.canParse(value) || new URL(value).protocol !== "https:") {
    return [`${name} is not a Sentry DSN, an https URL`];
  }
  const url = new URL(value);
  if (url.password) {
    return [`${name} carries the legacy DSN secret key after the ':'`];
  }
  return url.username ? [] : [`${name} is not a Sentry DSN: no public key`];
};

/**
 * The shape of each value the client reads, by name or by suffix. A name
 * `client-env.ts` reads without an entry here fails the build, so a new
 * public variable states what it may hold.
 *
 * @type {Array<[test: (name: string) => boolean, check: ShapeCheck]>}
 */
const VALUE_SHAPES = [
  [(name) => name === "REACT_APP_SENTRY_DSN", sentryDsn],
  [(name) => name.endsWith("_URL"), publicUrl],
  [
    (name) => name.endsWith("_SEND_TX_PER_SECOND"),
    checkWith(/^\d+(\.\d+)?$/, "a number"),
  ],
  // Signed, so a rate outside 0 to 1 reaches the browser's warning instead of failing the build
  [
    (name) => name === "REACT_APP_SENTRY_TRACES_SAMPLE_RATE",
    checkWith(/^-?\d+(\.\d+)?$/, "a number"),
  ],
  [
    (name) => name === "REACT_APP_GA_MEASUREMENT_ID",
    checkWith(GA4_ID, "a GA4 measurement id"),
  ],
  // The levels `isLevel` in src/shared/lib/logger/severity accepts
  [
    (name) => name === "REACT_APP_LOG_LEVEL",
    checkWith(/^(panic|error|warn|info|debug)$/, "a log level"),
  ],
  [
    (name) => name === "REACT_APP_SERVER_UNSTABLE",
    checkWith(/^(true|false|0|1)$/, "a boolean"),
  ],
  [
    (name) => name === "REACT_APP_VERCEL_ENV",
    checkWith(/^(production|preview|development)$/, "a Vercel environment"),
  ],
  [
    (name) => name === "REACT_APP_VERCEL_GIT_COMMIT_SHA",
    checkWith(/^[0-9a-f]{7,40}$/, "a commit sha"),
  ],
];

/**
 * Whether `name` has an entry in `VALUE_SHAPES`; a test checks every name
 * `client-env.ts` reads.
 *
 * @param {string} name
 * @returns {boolean}
 */
export const hasValueShape = (name) =>
  VALUE_SHAPES.some(([test]) => test(name));

/**
 * What a production build would publish that it must not, from the
 * environment webpack sees. Empty when the build may go ahead.
 *
 * A URL whose key the provider restricts to the production origin may be
 * published: list its variable in `PUBLIC_ENV_RESTRICTED_KEYS`
 * (comma-separated) to skip the key checks of that URL, and only those.
 *
 * @param {Set<string>} allowed the `REACT_APP_*` names the client reads
 * @param {Record<string, string | undefined>} env the build's environment
 * @returns {string[]} one message per problem, naming variables, never values
 */
export const publicEnvProblems = (allowed, env) => {
  const restricted = restrictedNames(env);
  const secretNames = new Map();
  for (const [name, value] of Object.entries(env).filter(isSecretEntry)) {
    secretNames.set(value, [...(secretNames.get(value) ?? []), name]);
  }
  const problems = [];
  for (const [name, value] of Object.entries(env)) {
    if (!isPublicName(name)) continue;
    if (!allowed.has(name)) {
      problems.push(
        `${name} is set, and the client does not read it; CRA inlines every ` +
          "REACT_APP_* into the bundle, so unset it"
      );
      continue;
    }
    if (!value) continue;
    if (secretNames.has(value)) {
      problems.push(
        `${name} has the value of ${secretNames.get(value).join(", ")}`
      );
    }
    if (TOKEN_PREFIXES.some((prefix) => value.startsWith(prefix))) {
      problems.push(`${name} holds a value shaped like a token`);
    }
    const shape = VALUE_SHAPES.find(([test]) => test(name));
    problems.push(
      ...(shape
        ? shape[1](name, value, restricted)
        : [`${name} has no entry in VALUE_SHAPES (scripts/public-env.mjs)`])
    );
  }
  for (const name of restricted) {
    if (!allowed.has(name) || !name.endsWith("_URL")) {
      problems.push(
        `PUBLIC_ENV_RESTRICTED_KEYS names ${name}, which is not a URL the client reads`
      );
    }
  }
  return problems;
};

/**
 * Throws when the build would publish something it must not; craco.config.js
 * calls it for every production build, after CRA has loaded the `.env` files.
 *
 * @param {Record<string, string | undefined>} env the build's environment
 */
export const assertPublicEnv = (env) => {
  const problems = publicEnvProblems(readClientEnvNames(), env);
  if (problems.length === 0) return;
  throw new Error(
    "public env: this build would publish what it must not:\n" +
      problems.map((problem) => `  - ${problem}`).join("\n") +
      "\nREACT_APP_* values are readable by every visitor. See " +
      'client-v2/docs/deploy-client-vercel.md, "Public variables".'
  );
};

/** The `.env` files CRA reads in a production build, in its order */
const ENV_FILES = [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
];

/**
 * The secret variables to look for in the build, by value: those of `env`
 * and of the `.env` files CRA reads in a production build, which a separate
 * Node process does not load on its own. Each file is read twice, by
 * `util.parseEnv` and by CRA's dotenv with dotenv-expand, and the values of
 * both are kept, so a value the build saw is searched whichever parser
 * produced it.
 *
 * @param {string} dir the folder holding the `.env` files
 * @param {Record<string, string | undefined>} env the process environment
 * @returns {Array<[name: string, value: string]>}
 */
export const secretsOf = (dir, env) => {
  const contents = ENV_FILES.map((file) => path.join(dir, file))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"));
  // dotenv never overrides a variable already set, so the first file wins
  const loaded = {};
  for (const content of contents) {
    for (const [name, value] of Object.entries(dotenv.parse(content))) {
      if (!(name in loaded)) loaded[name] = value;
    }
  }
  const expanded = dotenvExpand({
    parsed: Object.assign({}, loaded, env),
    ignoreProcessEnv: true,
  }).parsed;
  const pairs = [
    env,
    expanded,
    ...contents.map((content) => parseEnv(content)),
  ].flatMap((source) => Object.entries(source));
  const unique = new Map(
    pairs
      .filter(isSecretEntry)
      .map(([name, value]) => [`${name}\0${value}`, [name, value]])
  );
  return [...unique.values()];
};

/**
 * Which secrets a file of the build holds, as `<variable> in <file>`.
 *
 * @param {Array<[name: string, value: string]>} secrets from `secretsOf`
 * @param {string} buildDir the build's output folder
 * @returns {string[]}
 */
export const findSecretsInBuild = (secrets, buildDir) => {
  const files = fs
    .readdirSync(buildDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
  const searched = secrets.map(([name, value]) => [name, encodedForms(value)]);
  return files.flatMap((file) => {
    const content = fs.readFileSync(file);
    return searched
      .filter(([, forms]) => forms.some((form) => content.includes(form)))
      .map(([name]) => `${name} in ${path.relative(buildDir, file)}`);
  });
};

const main = ([command, buildDir]) => {
  if (command !== "check-build" || !buildDir) {
    console.error("usage: node scripts/public-env.mjs check-build <build-dir>");
    return 2;
  }
  const secrets = secretsOf(CLIENT_DIR, process.env);
  const found = findSecretsInBuild(secrets, path.resolve(buildDir));
  if (found.length === 0) {
    console.log(
      `public env: no value of ${secrets.length} secret variables in ${buildDir}`
    );
    return 0;
  }
  console.error(
    "public env: the build holds the value of a secret variable; do not " +
      "deploy it, and rotate the secret if a build like it was ever served:\n" +
      found.map((line) => `  - ${line}`).join("\n")
  );
  return 1;
};

if (path.basename(process.argv[1] ?? "") === "public-env.mjs") {
  process.exitCode = main(process.argv.slice(2));
}
