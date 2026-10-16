// The environment variables the browser bundle reads. `.env.example` documents
// them.
//
// Each is a literal `process.env.REACT_APP_*` member expression because CRA
// only inlines the ones it can see statically. `NODE_ENV` stays at its call
// sites: a literal comparison there is what lets the minifier drop
// development-only branches from the production bundle.

/** Build server override; unset means the Solana Foundation's server */
export const SERVER_URL = process.env.REACT_APP_SERVER_URL;

/** Platform RPC endpoints, one per cluster; unset adds no endpoint */
export const PLATFORM_RPC_URLS = {
  devnet: process.env.REACT_APP_DEVNET_RPC_URL,
  testnet: process.env.REACT_APP_TESTNET_RPC_URL,
  mainnet: process.env.REACT_APP_MAINNET_RPC_URL,
};

/**
 * Error reporting, analytics and the console log level; each unset turns its
 * part off. A getter, read when called, because tests stub these per case.
 */
export const observabilityEnv = () => ({
  SENTRY_DSN: process.env.REACT_APP_SENTRY_DSN,
  // Vercel copies its system variables with the CRA prefix at build time
  VERCEL_GIT_COMMIT_SHA: process.env.REACT_APP_VERCEL_GIT_COMMIT_SHA,
  VERCEL_ENV: process.env.REACT_APP_VERCEL_ENV,
  GA_MEASUREMENT_ID: process.env.REACT_APP_GA_MEASUREMENT_ID,
  LOG_LEVEL: process.env.REACT_APP_LOG_LEVEL,
});
