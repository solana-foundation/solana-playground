/**
 * The line wherever a faucet would be on a cluster `getAirdropAmount` has no
 * amount for: mainnet, or a custom URL whose cluster has none. Its own
 * module so the wallet menu can show it without loading the command.
 */
export const NO_FAUCET = "This network has no faucet.";

/**
 * The line where the selected endpoint's cluster could not be read (a custom
 * RPC that is down, or one whose genesis hash names no known cluster): the
 * wait for it would never end.
 */
export const COULD_NOT_READ_NETWORK =
  "Could not read the network. Check the RPC endpoint in Settings.";
