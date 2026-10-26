// The environment variables the serverless side reads: `api/*.mjs` and the
// `server.mjs` models behind them. `.mjs` so Node imports it directly (see
// api/health.mjs); `allowJs` lets TypeScript read the same file.
//
// Every getter reads `process.env` when called, never at import: tests stub
// the environment per case, and a value captured on import would outlive it.
// Each field is named after its variable, minus the group's prefix where all
// its variables share one: `agentEnv().API_KEY` is `AGENT_API_KEY`.
// Names and defaults live here and nowhere else; `.env.example` documents them.

import { createServerLogger } from "../lib/logger/server.mjs";

const log = createServerLogger("config:server-env");

/**
 * A variable's value as set, or `undefined` when it is unset or empty.
 * Node-only: a bundler inlines `process.env.NAME`, never `process.env[name]`.
 *
 * @param {string} name
 * @returns {string | undefined}
 */
const read = (name) => process.env[name] || undefined;

/**
 * A variable read as a non-negative number, or `fallback` when it is unset,
 * empty or not such a number. A malformed value is logged rather than thrown:
 * the limits it sets sit under the Gateway's own budgets, so the default is a
 * safe answer, and a throw would take the route down on every request.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
const readNumber = (name, fallback) =>
  readChecked(name, fallback, Number.isFinite, "a number >= 0");

/**
 * {@link readNumber} for a count: a byte or token limit, which a fraction
 * would turn into a request the upstream refuses.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
const readCount = (name, fallback) =>
  readChecked(name, fallback, Number.isInteger, "a whole number >= 0");

/**
 * @param {string} name
 * @param {number} fallback
 * @param {(value: number) => boolean} isValid
 * @param {string} expected what a valid value is, for the warning
 * @returns {number}
 */
const readChecked = (name, fallback, isValid, expected) => {
  const raw = read(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (isValid(value) && value >= 0) return value;
  log.warn(`${name}="${raw}" is not ${expected}`, {
    context: { using: fallback },
  });
  return fallback;
};

/**
 * Every variable `agentEnv` reads, by the suffix after its prefix: its field
 * names. Tests pin the two together, so a setting added to one is in the other.
 */
export const AGENT_SUFFIXES = [
  "API_KEY",
  "NEWCOMER_API_KEY",
  "BASE_URL",
  "MODEL",
  "REASONING_EFFORT",
  "PROVIDERS",
  "PRICE_INPUT",
  "PRICE_OUTPUT",
  "MAX_BODY_BYTES",
  "MAX_OUTPUT_TOKENS",
  "NEWCOMER_AGE_DAYS",
  "NEWCOMER_DAILY_CAP",
  "ESTABLISHED_DAILY_CAP",
];

/**
 * The deprecated `AGENT_*` names set in this environment, empty included.
 * The build check lists them, so a project shows in its build log what is
 * left to rename; once it lists none anywhere, the fallback below can go.
 *
 * @returns {string[]}
 */
export const deprecatedAgentNames = () =>
  AGENT_SUFFIXES.map((suffix) => `AGENT_${suffix}`).filter(
    (name) => process.env[name] !== undefined
  );

/** Messages already logged, so a warm instance logs each once */
const warned = new Set();

/** @param {string} message */
const warnOnce = (message) => {
  if (warned.has(message)) return;
  warned.add(message);
  log.warn(message);
};

/**
 * The variable that holds the assistant's `suffix` setting: `PG_AI_<suffix>`,
 * or its deprecated twin `AGENT_<suffix>` only when the new name is not set at
 * all. The build check reads the key's name through it, so the two cannot
 * disagree about which variable a deployment uses.
 *
 * @param {string} suffix
 * @returns {string}
 */
export const agentVariableName = (suffix) =>
  process.env[`PG_AI_${suffix}`] === undefined &&
  process.env[`AGENT_${suffix}`] !== undefined
    ? `AGENT_${suffix}`
    : `PG_AI_${suffix}`;

/**
 * Which of `PG_AI_<suffix>` and its deprecated twin `AGENT_<suffix>` to read.
 * The new name wins whenever it is set, even to an empty value, so
 * `PG_AI_API_KEY=` on a command still turns the backend off over a `.env`
 * that sets the old one. The old name is read only when the new one is not
 * set at all: deployments that predate the rename keep working until their
 * variables follow. Either case where the old name matters logs once:
 * read in place of the new one, or set to a different value and ignored (a
 * key rotated under the old name would otherwise never take effect).
 *
 * @param {string} suffix
 * @returns {{ name: string, value: string | undefined }} the variable read
 */
const resolveAgent = (suffix) => {
  const name = `PG_AI_${suffix}`;
  const legacy = `AGENT_${suffix}`;
  const value = process.env[name];
  const legacyValue = process.env[legacy];
  if (legacyValue === undefined) return { name, value };
  if (agentVariableName(suffix) === legacy) {
    warnOnce(`${legacy} is deprecated; rename it ${name}`);
    return { name: legacy, value: legacyValue };
  }
  if (value !== legacyValue) {
    warnOnce(`${legacy} is ignored: ${name} is set; delete ${legacy}`);
  }
  return { name, value };
};

/**
 * The name of the assistant's variable to read for `suffix`; see
 * {@link resolveAgent}.
 *
 * @param {string} suffix
 */
const agentName = (suffix) => resolveAgent(suffix).name;

/** Where turns go without `PG_AI_BASE_URL` */
const DEFAULT_AGENT_BASE_URL = "https://inference-api.nousresearch.com/v1";

/** The Gateway's host */
const GATEWAY_HOST = "ai-gateway.vercel.sh";

/**
 * Whether an upstream base URL is Vercel AI Gateway, the only upstream that
 * takes `providerOptions`.
 *
 * @param {string} baseUrl
 */
const isGatewayUrl = (baseUrl) =>
  URL.canParse(baseUrl) && new URL(baseUrl).host === GATEWAY_HOST;

/**
 * `PG_AI_PROVIDERS`: the Gateway providers a turn may be served by.
 *
 * The one variable where empty differs from unset: set but empty sends no
 * routing restriction. Unset, it defaults to the US-region, zero-retention
 * providers of the design's decision 1 -- but only when the upstream is the
 * Gateway. Any other upstream refuses the unknown `providerOptions` field
 * (Nous answers `400 unknown_parameter`), so a deployment that has not moved
 * yet, or has rolled back, needs no variable to keep working.
 *
 * @param {string} baseUrl the upstream `PG_AI_BASE_URL` resolves to
 * @returns {string[]}
 */
const readProviders = (baseUrl) => {
  const raw = resolveAgent("PROVIDERS").value;
  if (raw !== undefined) {
    return raw
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean);
  }
  return isGatewayUrl(baseUrl) ? ["baseten", "fireworks"] : [];
};

/**
 * `PG_AI_*`: the assistant's Default backend. Only `API_KEY` has no default:
 * without it the backend is off. `NEWCOMER_API_KEY` has none either: without
 * it newcomers spend through `API_KEY`, still held to the newcomer cap.
 *
 * Prices and caps are USD; the ledger converts them to micro-USD.
 */
export const agentEnv = () => ({
  /** The `established` tier's key, and every tier's without `NEWCOMER_API_KEY` */
  API_KEY: read(agentName("API_KEY")),
  NEWCOMER_API_KEY: read(agentName("NEWCOMER_API_KEY")),
  BASE_URL: read(agentName("BASE_URL")) || DEFAULT_AGENT_BASE_URL,
  MODEL: read(agentName("MODEL")) || "z-ai/glm-5.3-flash:US",
  // GLM always reasons and defaults to `max`; the panel shows none of it, so
  // a high effort reads as a stalled answer
  REASONING_EFFORT: read(agentName("REASONING_EFFORT")) || "low",
  PROVIDERS: readProviders(
    read(agentName("BASE_URL")) || DEFAULT_AGENT_BASE_URL
  ),
  /** USD per million input tokens */
  PRICE_INPUT: readNumber(agentName("PRICE_INPUT"), 0.15),
  /** USD per million output tokens */
  PRICE_OUTPUT: readNumber(agentName("PRICE_OUTPUT"), 0.5),
  /** About 128k input tokens at 4 bytes per token */
  MAX_BODY_BYTES: readCount(agentName("MAX_BODY_BYTES"), 524288),
  /** Sent as `max_completion_tokens` on every upstream request */
  MAX_OUTPUT_TOKENS: readCount(agentName("MAX_OUTPUT_TOKENS"), 8192),
  /** A GitHub account younger than this many days is a `newcomer` */
  NEWCOMER_AGE_DAYS: readNumber(agentName("NEWCOMER_AGE_DAYS"), 30),
  /** USD per user per UTC day */
  NEWCOMER_DAILY_CAP: readNumber(agentName("NEWCOMER_DAILY_CAP"), 0.1),
  /** USD per user per UTC day */
  ESTABLISHED_DAILY_CAP: readNumber(agentName("ESTABLISHED_DAILY_CAP"), 0.5),
});

/**
 * `SOURCES` replaces `SOURCES_CATALOGUE` (`shared/config/sources.mjs`). The
 * catalogue's own variables (`MCP_EXPLORER_*`) are named there, as
 * placeholders filled from the whole environment, so they have no getter here.
 */
export const sourcesEnv = () => ({
  SOURCES: read("SOURCES"),
});

/**
 * Postgres for sync, and its opt-in kill switch. `DB_PROVIDER` picks how the
 * pool is built (`model/providers/` in the persistence feature); each provider
 * reads only its own variables.
 */
export const databaseEnv = () => ({
  // Unset means `url`. Any other value is passed through so the pool can
  // refuse it by name, never guessed from which variables happen to be set
  DB_PROVIDER: read("DB_PROVIDER") || "url",
  DATABASE_URL: read("DATABASE_URL"),
  // `cloud-sql`: `<project>:<region>:<instance>`, the database, and the IAM
  // database user (a service account's e-mail without `.gserviceaccount.com`)
  CLOUD_SQL_INSTANCE: read("CLOUD_SQL_INSTANCE"),
  CLOUD_SQL_DATABASE: read("CLOUD_SQL_DATABASE"),
  CLOUD_SQL_USER: read("CLOUD_SQL_USER"),
  // `cloud-sql`: Workload Identity Federation, which trades the deployment's
  // Vercel OIDC token for the service account below
  GCP_PROJECT_NUMBER: read("GCP_PROJECT_NUMBER"),
  GCP_WORKLOAD_IDENTITY_POOL_ID: read("GCP_WORKLOAD_IDENTITY_POOL_ID"),
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: read(
    "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"
  ),
  GCP_SERVICE_ACCOUNT_EMAIL: read("GCP_SERVICE_ACCOUNT_EMAIL"),
  // Vercel's own; the `cloud-sql` provider keeps everything but production off
  // the production database by it
  VERCEL_ENV: read("VERCEL_ENV"),
  // Only the exact string enables sync; anything else keeps it off
  SYNC_ENABLED: process.env.SYNC_ENABLED === "true",
});

/**
 * The browser's observability ids, read here only to warn when a deployment
 * lacks them. Full names, since `missingObservabilityIds` looks each up by name.
 */
export const observabilityEnv = () => ({
  REACT_APP_SENTRY_DSN: read("REACT_APP_SENTRY_DSN"),
  REACT_APP_GA_MEASUREMENT_ID: read("REACT_APP_GA_MEASUREMENT_ID"),
});

/**
 * Sentry for the API functions. Full names, since `sentryEnabled`
 * (scripts/sentry-gate.mjs) looks each up by name. `VERCEL_*` are Vercel's
 * system variables, present at runtime.
 */
export const sentryEnv = () => ({
  REACT_APP_SENTRY_DSN: read("REACT_APP_SENTRY_DSN"),
  SENTRY_PREVIEW_ENABLED: read("SENTRY_PREVIEW_ENABLED"),
  SENTRY_TRACES_SAMPLE_RATE: read("SENTRY_TRACES_SAMPLE_RATE"),
  VERCEL_ENV: read("VERCEL_ENV"),
  VERCEL_GIT_COMMIT_SHA: read("VERCEL_GIT_COMMIT_SHA"),
});

/**
 * Better Auth's secret and GitHub credentials, and the origins it can build
 * URLs from. `VERCEL_URL` is Vercel's own hostname for the deployment and
 * `VERCEL_BRANCH_URL` its branch alias, both without a scheme.
 */
export const authEnv = () => ({
  AUTH_BASE_URL: read("AUTH_BASE_URL"),
  VERCEL_URL: read("VERCEL_URL"),
  VERCEL_BRANCH_URL: read("VERCEL_BRANCH_URL"),
  AUTH_SECRET: read("AUTH_SECRET"),
  GITHUB_CLIENT_ID: read("GITHUB_CLIENT_ID"),
  GITHUB_CLIENT_SECRET: read("GITHUB_CLIENT_SECRET"),
  // The OAuth proxy: no secret leaves it off; only a Vercel preview with a URL
  // naming another deployment completes a proxied sign-in
  AUTH_OAUTH_PROXY_URL: read("AUTH_OAUTH_PROXY_URL"),
  AUTH_OAUTH_PROXY_SECRET: read("AUTH_OAUTH_PROXY_SECRET"),
  VERCEL_ENV: read("VERCEL_ENV"),
});
