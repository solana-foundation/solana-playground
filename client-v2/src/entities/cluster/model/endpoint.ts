// Imports nothing and holds no in-source block, so Playwright's CommonJS compile of `e2e/` can import it

/** A cluster's public RPC endpoint */
export enum Endpoint {
  LOCALNET = "http://localhost:8899",
  /**
   * `surfpool start`'s RPC. Its port is Localnet's; the host tells the two
   * offered networks apart, and both resolve to the `localnet` cluster.
   */
  SURFPOOL = "http://127.0.0.1:8899",
  DEVNET = "https://api.devnet.solana.com",
  TESTNET = "https://api.testnet.solana.com",
  MAINNET = "https://api.mainnet-beta.solana.com",
}
