// `.mjs` so vitest, Playwright and `node --test` load the same file; never imported by app code

/** RPC URLs for tests that need some endpoint, not a cluster's: the `.test` TLD never resolves (RFC 6761), so a missed stub cannot reach a real RPC */
export const TEST_ENDPOINT = Object.freeze({
  DEVNET: "https://devnet.rpc.test",
  TESTNET: "https://testnet.rpc.test",
  MAINNET_BETA: "https://mainnet-beta.rpc.test",
});

/** Plain-HTTP URLs the `no-insecure-url` loopback exception in `eslint.config.mjs` accepts */
export const LOOPBACK_URL = Object.freeze({
  LOCALHOST: "http://localhost:3000",
  LOCALHOST_WITH_PATH: "http://localhost:3000/rpc",
  IPV4: "http://127.0.0.1:8899",
});

/* eslint-disable @microsoft/sdl/no-insecure-url -- each one is a probe the rule must refuse */
/** Plain-HTTP URLs that look loopback but reach another host, which the exception refuses */
export const NOT_LOOPBACK_URL = Object.freeze({
  HOST_STARTING_WITH_LOCALHOST: "http://localhost.evil.test",
  LOCALHOST_AS_USERINFO: "http://localhost:3000@evil.example",
  UNSPECIFIED_ADDRESS: "http://0.0.0.0:8899",
  REMOTE: "http://example.test",
});
/* eslint-enable @microsoft/sdl/no-insecure-url */
