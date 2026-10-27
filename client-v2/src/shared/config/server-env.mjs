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
 * `AGENT_*`: the assistant's Default backend. Only `API_KEY` has no default:
 * without it the backend is off.
 */
export const agentEnv = () => ({
  API_KEY: read("AGENT_API_KEY"),
  BASE_URL:
    read("AGENT_BASE_URL") || "https://inference-api.nousresearch.com/v1",
  MODEL: read("AGENT_MODEL") || "z-ai/glm-5.3-flash:US",
  // GLM always reasons and defaults to `max`; the panel shows none of it, so
  // a high effort reads as a stalled answer
  REASONING_EFFORT: read("AGENT_REASONING_EFFORT") || "low",
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
