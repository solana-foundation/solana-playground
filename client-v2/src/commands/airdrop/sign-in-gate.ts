/**
 * Clusters whose faucet is the user's own validator: any `localhost` or
 * `127.0.0.1` endpoint reads as `localnet` (Localnet and Surfpool, on any
 * port), and Playnet runs in the browser. Nothing public is spent there, and
 * upstream's `client/` asks for no sign-in before any airdrop.
 */
const LOCAL_FAUCETS = new Set(["localnet", "playnet"]);

/**
 * Whether an airdrop on `cluster` asks for a sign-in first. The gate guards
 * the public faucets (devnet, testnet); an unread cluster (`null`) or an
 * unknown one stays gated, so the gate never opens by mistake.
 *
 * Imports nothing, so the Deploy stage and the wallet menu read it without
 * loading the airdrop command.
 */
export const isAirdropSignInGated = (cluster: string | null | undefined) =>
  cluster === null || cluster === undefined || !LOCAL_FAUCETS.has(cluster);
