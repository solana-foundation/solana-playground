// The environment variables the serverless side reads: `api/*.mjs` and the
// `server.mjs` models behind them. `.mjs` so Node imports it directly (see
// api/health.mjs); `allowJs` lets TypeScript read the same file.
//
// Every getter reads `process.env` when called, never at import: tests stub
// the environment per case, and a value captured on import would outlive it.
// Each field is named after its variable, minus the group's prefix where all
// its variables share one: `mcpExplorerEnv().BYPASS` is `MCP_EXPLORER_BYPASS`.
// Names and defaults live here and nowhere else; `.env.example` documents them.

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
  console.warn(`server-env: ${name}="${raw}" is not ${expected}`, {
    using: fallback,
  });
  return fallback;
};

/** Where turns go without `AGENT_BASE_URL` */
const DEFAULT_AGENT_BASE_URL = "https://inference-api.nousresearch.com/v1";

/** The Gateway's host */
const GATEWAY_HOST = "ai-gateway.vercel.sh";

/**
 * Whether an upstream base URL is Vercel AI Gateway. The request differs by
 * upstream: only the Gateway takes `providerOptions`, and it documents
 * `max_tokens` where Nous Research takes only `max_completion_tokens`.
 *
 * @param {string} baseUrl
 */
export const isGatewayUrl = (baseUrl) =>
  URL.canParse(baseUrl) && new URL(baseUrl).host === GATEWAY_HOST;

/**
 * `AGENT_PROVIDERS`: the Gateway providers a turn may be served by.
 *
 * The one variable where empty differs from unset: set but empty sends no
 * routing restriction. Unset, it defaults to the US-region, zero-retention
 * providers of the design's decision 1 -- but only when the upstream is the
 * Gateway. Any other upstream refuses the unknown `providerOptions` field
 * (Nous answers `400 unknown_parameter`), so a deployment that has not moved
 * yet, or has rolled back, needs no variable to keep working.
 *
 * @param {string} baseUrl the upstream `AGENT_BASE_URL` resolves to
 * @returns {string[]}
 */
const readProviders = (baseUrl) => {
  const raw = process.env.AGENT_PROVIDERS;
  if (raw !== undefined) {
    return raw
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean);
  }
  return isGatewayUrl(baseUrl) ? ["baseten", "fireworks"] : [];
};

/**
 * `AGENT_*`: the assistant's Default backend. Only `API_KEY` has no default:
 * without it the backend is off. `NEWCOMER_API_KEY` has none either: without
 * it newcomers spend through `API_KEY`, still held to the newcomer cap.
 *
 * Prices and caps are USD; the ledger converts them to micro-USD.
 */
export const agentEnv = () => ({
  /** The `established` tier's key, and every tier's without `NEWCOMER_API_KEY` */
  API_KEY: read("AGENT_API_KEY"),
  NEWCOMER_API_KEY: read("AGENT_NEWCOMER_API_KEY"),
  BASE_URL: read("AGENT_BASE_URL") || DEFAULT_AGENT_BASE_URL,
  MODEL: read("AGENT_MODEL") || "z-ai/glm-5.3-flash:US",
  // GLM always reasons and defaults to `max`; the panel shows none of it, so
  // a high effort reads as a stalled answer
  REASONING_EFFORT: read("AGENT_REASONING_EFFORT") || "low",
  PROVIDERS: readProviders(read("AGENT_BASE_URL") || DEFAULT_AGENT_BASE_URL),
  /** USD per million input tokens */
  PRICE_INPUT: readNumber("AGENT_PRICE_INPUT", 0.15),
  /** USD per million output tokens */
  PRICE_OUTPUT: readNumber("AGENT_PRICE_OUTPUT", 0.5),
  /** About 128k input tokens at 4 bytes per token */
  MAX_BODY_BYTES: readCount("AGENT_MAX_BODY_BYTES", 524288),
  /** Sent as `max_tokens` on every upstream request */
  MAX_OUTPUT_TOKENS: readCount("AGENT_MAX_OUTPUT_TOKENS", 8192),
  /** A GitHub account younger than this many days is a `newcomer` */
  NEWCOMER_AGE_DAYS: readNumber("AGENT_NEWCOMER_AGE_DAYS", 30),
  /** USD per user per UTC day */
  NEWCOMER_DAILY_CAP: readNumber("AGENT_NEWCOMER_DAILY_CAP", 0.1),
  /** USD per user per UTC day */
  ESTABLISHED_DAILY_CAP: readNumber("AGENT_ESTABLISHED_DAILY_CAP", 0.5),
});

/** `MCP_EXPLORER_*`: the Explorer MCP upstream; no `BYPASS` leaves it out */
export const mcpExplorerEnv = () => ({
  BYPASS: read("MCP_EXPLORER_BYPASS"),
  URL: read("MCP_EXPLORER_URL") || "https://explorer.solana.com/mcp",
  TOKEN: read("MCP_EXPLORER_TOKEN"),
});

/** Postgres for sync, and its opt-in kill switch */
export const databaseEnv = () => ({
  DATABASE_URL: read("DATABASE_URL"),
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
