// The environment variables the browser bundle reads. `.env.example` documents
// them.
//
// Each is a literal `process.env.REACT_APP_*` member expression because CRA
// only inlines the ones it can see statically. `NODE_ENV` stays at its call
// sites: a literal comparison there is what lets the minifier drop
// development-only branches from the production bundle.

/** The deployment's build server, listed as "Solana Foundation"; unset means a local server */
export const BUILD_SERVER_URL = process.env.REACT_APP_SERVER_URL;

/** Default of `experimental.unstable`; only `"true"` turns it on */
export const BUILD_SERVER_UNSTABLE = process.env.REACT_APP_SERVER_UNSTABLE;

/** Platform RPC endpoints for Devnet, Mainnet and Testnet; unset falls back to the public one */
export const PLATFORM_RPC_URLS = {
  devnet: process.env.REACT_APP_DEVNET_RPC_URL,
  mainnet: process.env.REACT_APP_MAINNET_RPC_URL,
  testnet: process.env.REACT_APP_TESTNET_RPC_URL,
};

/** RPC endpoints program buffer accounts are read through, one per cluster; unset or `""` reads through the selected endpoint */
export const READ_BUFFER_RPC_URLS = {
  devnet: process.env.REACT_APP_DEVNET_READ_BUFFER_RPC_URL,
  testnet: process.env.REACT_APP_TESTNET_READ_BUFFER_RPC_URL,
  mainnet: process.env.REACT_APP_MAINNET_READ_BUFFER_RPC_URL,
};

/** The most buffer writes per second a deploy sends on the cluster, set just below the RPC plan's `sendTransaction` limit; only a positive number overrides `DEFAULT_SEND_TX_PER_SECOND` in `entities/cluster` */
export const SEND_TX_PER_SECOND = {
  devnet: process.env.REACT_APP_DEVNET_SEND_TX_PER_SECOND,
  testnet: process.env.REACT_APP_TESTNET_SEND_TX_PER_SECOND,
  mainnet: process.env.REACT_APP_MAINNET_SEND_TX_PER_SECOND,
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

/**
 * Where the built-in wallet's keys live: the key page's origin, and the app
 * origin the key page answers. `loopback` swaps `localhost` and `127.0.0.1`;
 * an unset key origin keeps the keys in the page. A getter, read when called,
 * because tests stub these per case.
 */
export const walletOriginEnv = () => ({
  KEY_ORIGIN: process.env.REACT_APP_WALLET_KEY_ORIGIN,
  APP_ORIGIN: process.env.REACT_APP_WALLET_APP_ORIGIN,
});
